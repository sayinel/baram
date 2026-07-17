// §30.2 Graph View — continuous force simulation (d3-force) driving cytoscape positions
import type { SimulationLinkDatum, SimulationNodeDatum } from "d3-force";

import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
} from "d3-force";

export interface ForceSettings {
  /** 0..1 slider — pull toward the origin */
  centerForce: number;
  /** 30..500 px — ideal link length */
  linkDistance: number;
  /** 0..1 slider — link spring strength */
  linkForce: number;
  /** 0..50 slider — node repulsion */
  repelForce: number;
}

export interface GraphSimulation {
  drag(id: string, x: number, y: number): void;
  endDrag(id: string): void;
  getNodes(): ReadonlyArray<SimNode>;
  getPinnedIds(): ReadonlySet<string>;
  getPositions(): ReadonlyMap<string, { x: number; y: number }>;
  isFrozen(): boolean;
  isPinned(id: string): boolean;
  pin(id: string): void;
  reheat(): void;
  setFrozen(frozen: boolean): void;
  setGraph(
    nodes: SimNodeInput[],
    links: SimLinkInput[],
    opts?: SetGraphOptions,
  ): void;
  startDrag(id: string): void;
  stop(): void;
  tickSync(iterations: number): void;
  unpin(id: string): void;
  updateForces(settings: ForceSettings): void;
  updateRadii(radii: ReadonlyMap<string, number>): void;
}

export interface SetGraphOptions {
  /** restart alpha after graph swap (0 = stay stopped) */
  alpha?: number;
  /** synchronous ticks before first paint (initial load) */
  warmupTicks?: number;
}

export interface SimLinkInput {
  source: string;
  target: string;
}

export interface SimNode extends SimulationNodeDatum {
  id: string;
  radius: number;
}

export interface SimNodeInput {
  id: string;
  radius: number;
}

type SimLink = SimulationLinkDatum<SimNode>;

// Scaling constants — calibrated so default sliders (center 0.25, repel 8,
// link 0.45, distance 80) approximate the old fcose feel. §30.2
const REPEL_SCALE = 40;
const REPEL_DISTANCE_MAX = 600;
const CENTER_SCALE = 0.1;
const COLLIDE_PADDING = 6;
const COLLIDE_ITERATIONS = 2;
const DRAG_ALPHA_TARGET = 0.3;
const DEFAULT_SWAP_ALPHA = 0.3;
const RELAYOUT_ALPHA = 0.8;
const NEW_NODE_JITTER = 30;

/**
 * Create a continuous d3-force simulation for the graph view.
 *
 * `onTick` receives the node array every tick — the caller writes positions
 * into the renderer. With `manual: true` the simulation never self-runs
 * (drive it with `tickSync`; used in tests and available for headless work).
 */
export function createGraphSimulation(
  initialSettings: ForceSettings,
  onTick: (nodes: ReadonlyArray<SimNode>) => void,
  opts?: { manual?: boolean },
): GraphSimulation {
  const manual = opts?.manual ?? false;
  let nodes: SimNode[] = [];
  let nodeById = new Map<string, SimNode>();
  let frozen = false;
  let settings: ForceSettings = { ...initialSettings };
  /** last known positions — survives setGraph so graphs don't jump on refresh */
  const positions = new Map<string, { x: number; y: number }>();
  /** §30.3c pinned node ids — pins survive setGraph swaps (session-scoped) */
  const pinnedIds = new Set<string>();

  const chargeForce = forceManyBody<SimNode>().distanceMax(REPEL_DISTANCE_MAX);
  const xForce = forceX<SimNode>(0);
  const yForce = forceY<SimNode>(0);
  const collideForce = forceCollide<SimNode>(
    (d) => d.radius + COLLIDE_PADDING,
  ).iterations(COLLIDE_ITERATIONS);
  let linkForceInstance = forceLink<SimNode, SimLink>([]).id((d) => d.id);

  function applyForces(): void {
    chargeForce.strength(-settings.repelForce * REPEL_SCALE);
    xForce.strength(settings.centerForce * CENTER_SCALE);
    yForce.strength(settings.centerForce * CENTER_SCALE);
    linkForceInstance
      .distance(settings.linkDistance)
      .strength(settings.linkForce);
  }

  function notify(): void {
    for (const n of nodes) {
      positions.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
    }
    onTick(nodes);
  }

  const simulation = forceSimulation<SimNode>([])
    .force("charge", chargeForce)
    .force("x", xForce)
    .force("y", yForce)
    .force("collide", collideForce)
    .force("link", linkForceInstance)
    .on("tick", notify);
  simulation.stop();
  applyForces();

  function restart(alpha: number): void {
    if (manual || frozen || alpha <= 0) return;
    simulation.alpha(alpha).restart();
  }

  return {
    setGraph(nodeInputs, links, o) {
      nodes = nodeInputs.map((input) => {
        const node: SimNode = { id: input.id, radius: input.radius };
        const prev = positions.get(input.id);
        if (prev) {
          node.x = prev.x;
          node.y = prev.y;
          // §30.3c re-apply surviving pins at their preserved position
          if (pinnedIds.has(input.id)) {
            node.fx = prev.x;
            node.fy = prev.y;
          }
        }
        return node;
      });
      nodeById = new Map(nodes.map((n) => [n.id, n]));
      // Seed brand-new nodes near an already-positioned link neighbor so they
      // grow out of the existing layout instead of appearing at the origin.
      for (const n of nodes) {
        if (n.x !== undefined) continue;
        for (const l of links) {
          const otherId =
            l.source === n.id ? l.target : l.target === n.id ? l.source : null;
          if (!otherId) continue;
          const other = nodeById.get(otherId);
          if (other?.x !== undefined && other.y !== undefined) {
            n.x = other.x + (Math.random() - 0.5) * NEW_NODE_JITTER;
            n.y = other.y + (Math.random() - 0.5) * NEW_NODE_JITTER;
            break;
          }
        }
        // else: leave undefined → d3 phyllotaxis initial placement
      }
      linkForceInstance = forceLink<SimNode, SimLink>(
        links.map((l) => ({ source: l.source, target: l.target })),
      ).id((d) => d.id);
      simulation.nodes(nodes);
      simulation.force("link", linkForceInstance);
      applyForces();
      const warmup = o?.warmupTicks ?? 0;
      if (warmup > 0) {
        simulation.alpha(1);
        simulation.tick(warmup);
        notify();
      }
      restart(o?.alpha ?? DEFAULT_SWAP_ALPHA);
    },

    startDrag(id) {
      const node = nodeById.get(id);
      if (!node) return;
      node.fx = node.x;
      node.fy = node.y;
      if (!manual && !frozen) {
        simulation.alphaTarget(DRAG_ALPHA_TARGET).restart();
      }
    },

    drag(id, x, y) {
      const node = nodeById.get(id);
      if (!node) return;
      node.fx = x;
      node.fy = y;
      node.x = x;
      node.y = y;
    },

    endDrag(id) {
      const node = nodeById.get(id);
      if (!node) return;
      // §30.3c pinned nodes stay where they were dropped (fx/fy already at
      // the drop position from drag()); unpinned nodes rejoin the physics
      if (!pinnedIds.has(id)) {
        node.fx = null;
        node.fy = null;
      }
      if (!manual && !frozen) {
        simulation.alphaTarget(0);
      }
    },

    pin(id) {
      const node = nodeById.get(id);
      if (!node) return;
      pinnedIds.add(id);
      node.fx = node.x;
      node.fy = node.y;
    },

    unpin(id) {
      pinnedIds.delete(id);
      const node = nodeById.get(id);
      if (!node) return;
      node.fx = null;
      node.fy = null;
      restart(DEFAULT_SWAP_ALPHA);
    },

    isPinned(id) {
      return pinnedIds.has(id);
    },

    getPinnedIds() {
      return pinnedIds;
    },

    updateForces(next) {
      settings = { ...next };
      applyForces();
      restart(DEFAULT_SWAP_ALPHA);
    },

    updateRadii(radii) {
      for (const n of nodes) {
        const r = radii.get(n.id);
        if (r !== undefined) n.radius = r;
      }
      // re-set the accessor so forceCollide re-reads the cached radii
      collideForce.radius((d) => d.radius + COLLIDE_PADDING);
      restart(DEFAULT_SWAP_ALPHA);
    },

    reheat() {
      frozen = false;
      if (!manual) {
        simulation.alpha(RELAYOUT_ALPHA).restart();
      }
    },

    setFrozen(next) {
      frozen = next;
      if (frozen) simulation.stop();
    },

    isFrozen() {
      return frozen;
    },

    tickSync(iterations) {
      simulation.tick(iterations);
      notify();
    },

    getNodes() {
      return nodes;
    },

    getPositions() {
      return positions;
    },

    stop() {
      simulation.stop();
      simulation.on("tick", null);
    },
  };
}
