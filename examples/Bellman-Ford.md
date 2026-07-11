---
title: Bellman-Ford
tags: [algorithms, graphs]
---

# Bellman-Ford

A shortest-path algorithm that — unlike [[Dijkstra's Algorithm]] — **handles
negative edge weights** and can detect negative cycles.

It relaxes every edge $V - 1$ times, giving $O(V \cdot E)$ time.

> [!warning] Trade-off
> More general than Dijkstra, but slower. Prefer Dijkstra when all edge weights
> are non-negative. #graphs
