---
title: Priority Queue
tags: [data-structures]
---

# Priority Queue

An abstract data type where each element carries a **priority**; the highest-
priority element is served first. Usually backed by a *binary heap*.

Core operations run in $O(\log n)$:

| Operation   | Complexity  |
| ----------- | ----------- |
| insert      | $O(\log n)$ |
| extract-min | $O(\log n)$ |
| peek        | $O(1)$      |

[[Dijkstra's Algorithm]] relies on a priority queue to always pick the closest
unvisited vertex. #data-structures
