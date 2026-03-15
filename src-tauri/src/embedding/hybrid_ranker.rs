// §11.4.3 Hybrid Ranker — BM25 + vector + graph scoring with diversity enforcement

use std::collections::{HashMap, HashSet, VecDeque};

/// Configuration for hybrid ranking weights.
#[derive(Debug, Clone)]
pub struct RankConfig {
    /// Weight for BM25 (keyword) score.
    pub alpha: f32,
    /// Weight for vector (semantic) score.
    pub beta: f32,
    /// Weight for graph (link proximity) score.
    pub gamma: f32,
}

/// A ranked search result chunk.
#[derive(Debug, Clone)]
pub struct RankedChunk {
    pub id: String,
    pub file_path: String,
    pub score: f32,
}

/// Combine BM25, vector, and graph scores with weighted sum.
pub fn combine_scores(bm25: f32, vector: f32, graph: f32, config: &RankConfig) -> f32 {
    config.alpha * bm25 + config.beta * vector + config.gamma * graph
}

/// Normalize scores to [0, 1] using min-max normalization.
pub fn normalize_min_max(scores: &[f32]) -> Vec<f32> {
    if scores.is_empty() {
        return vec![];
    }

    let min = scores.iter().cloned().fold(f32::INFINITY, f32::min);
    let max = scores.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
    let range = max - min;

    if range == 0.0 {
        return vec![0.0; scores.len()];
    }

    scores.iter().map(|&s| (s - min) / range).collect()
}

/// Compute graph proximity score based on hop distance.
/// Returns 1/(1+hop_distance): current file = 1.0, 1-hop = 0.5, 2-hop = 0.333...
pub fn graph_proximity(hop_distance: u32) -> f32 {
    1.0 / (1.0 + hop_distance as f32)
}

/// Enforce diversity by limiting max results per file.
pub fn enforce_diversity(results: Vec<RankedChunk>, max_per_file: usize) -> Vec<RankedChunk> {
    let mut file_counts: HashMap<String, usize> = HashMap::new();
    let mut diverse = Vec::new();

    for chunk in results {
        let count = file_counts.entry(chunk.file_path.clone()).or_insert(0);
        if *count < max_per_file {
            *count += 1;
            diverse.push(chunk);
        }
    }

    diverse
}

/// Automatically determine ranking weights based on query characteristics.
///
/// Heuristic:
/// - Short queries with technical terms → keyword (BM25) favored
/// - Longer question-style queries → semantic (vector) favored
pub fn auto_weights(query: &str) -> RankConfig {
    let words: Vec<&str> = query.split_whitespace().collect();
    let word_count = words.len();

    // Question indicators (Korean and English)
    let is_question = query.contains('?')
        || query.contains("알려")
        || query.contains("설명")
        || query.contains("무엇")
        || query.contains("어떻게")
        || query.contains("왜")
        || query.contains("대해")
        || query.contains("what")
        || query.contains("how")
        || query.contains("why")
        || query.contains("explain")
        || query.contains("describe")
        || query.contains("about");

    // Technical term indicators (short, specific terms)
    let has_technical = words.iter().any(|w| {
        w.contains('_')
            || w.contains("::")
            || w.contains('.')
            || w.chars().all(|c| c.is_ascii_uppercase())
            || (w.len() <= 5 && w.chars().all(|c| c.is_ascii_alphanumeric()))
    });

    if is_question || word_count >= 5 {
        // Semantic query — favor vector
        RankConfig {
            alpha: 0.2,
            beta: 0.6,
            gamma: 0.2,
        }
    } else if has_technical || word_count <= 3 {
        // Keyword query — favor BM25
        RankConfig {
            alpha: 0.6,
            beta: 0.2,
            gamma: 0.2,
        }
    } else {
        // Balanced
        RankConfig {
            alpha: 0.4,
            beta: 0.4,
            gamma: 0.2,
        }
    }
}

/// Simple BM25-like TF score for a query against chunk content.
/// Uses term frequency normalized by document length.
/// Not a full BM25 (no IDF across corpus), but sufficient for re-ranking.
pub fn bm25_score_chunk(query: &str, chunk_content: &str) -> f32 {
    let query_terms: Vec<String> = query.split_whitespace().map(|t| t.to_lowercase()).collect();
    if query_terms.is_empty() {
        return 0.0;
    }

    let content_lower = chunk_content.to_lowercase();
    let content_words: Vec<&str> = content_lower.split_whitespace().collect();
    let doc_len = content_words.len() as f32;
    if doc_len == 0.0 {
        return 0.0;
    }

    // BM25 parameters
    let k1: f32 = 1.2;
    let b: f32 = 0.75;
    let avg_dl: f32 = 200.0; // approximate average chunk length in words

    let mut score = 0.0;
    for term in &query_terms {
        let tf = content_words
            .iter()
            .filter(|w| w.contains(term.as_str()))
            .count() as f32;
        if tf > 0.0 {
            // Simplified BM25 term score (IDF=1 since we don't have corpus stats)
            let numerator = tf * (k1 + 1.0);
            let denominator = tf + k1 * (1.0 - b + b * (doc_len / avg_dl));
            score += numerator / denominator;
        }
    }

    score / query_terms.len() as f32
}

/// Compute hop distance from `current_file` to each `target_file` using BFS on the link graph.
/// `outgoing` maps source_path → list of target_paths.
/// Returns a map of file_path → hop_distance (u32). Files not reachable return None.
pub fn compute_hop_distances(
    current_file: &str,
    target_files: &[String],
    outgoing: &HashMap<String, Vec<String>>,
) -> HashMap<String, u32> {
    let target_set: HashSet<&String> = target_files.iter().collect();
    let mut distances: HashMap<String, u32> = HashMap::new();
    let mut visited: HashSet<String> = HashSet::new();
    let mut queue: VecDeque<(String, u32)> = VecDeque::new();

    queue.push_back((current_file.to_string(), 0));
    visited.insert(current_file.to_string());

    // BFS with max 3 hops to limit search scope
    while let Some((file, depth)) = queue.pop_front() {
        if depth > 3 {
            break;
        }

        if target_set.contains(&file) {
            distances.insert(file.clone(), depth);
        }

        if let Some(neighbors) = outgoing.get(&file) {
            for neighbor in neighbors {
                if !visited.contains(neighbor) {
                    visited.insert(neighbor.clone());
                    queue.push_back((neighbor.clone(), depth + 1));
                }
            }
        }
    }

    distances
}

/// Perform full hybrid ranking on vector search results.
/// Enriches vector results with BM25 and graph proximity scores, then combines.
#[allow(clippy::too_many_arguments)]
pub fn hybrid_rank(
    query: &str,
    vector_results: Vec<RankedChunk>,
    vector_scores: &[f32],
    chunk_contents: &HashMap<String, String>,
    current_file: Option<&str>,
    outgoing: &HashMap<String, Vec<String>>,
    top_k: usize,
) -> Vec<RankedChunk> {
    if vector_results.is_empty() {
        return vec![];
    }

    let config = auto_weights(query);

    // Compute BM25 scores for each result
    let raw_bm25: Vec<f32> = vector_results
        .iter()
        .map(|r| {
            chunk_contents
                .get(&r.id)
                .map(|content| bm25_score_chunk(query, content))
                .unwrap_or(0.0)
        })
        .collect();
    let norm_bm25 = normalize_min_max(&raw_bm25);

    // Normalize vector scores
    let norm_vector = normalize_min_max(vector_scores);

    // Compute graph proximity scores
    let target_files: Vec<String> = vector_results.iter().map(|r| r.file_path.clone()).collect();
    let hop_distances = if let Some(cf) = current_file {
        compute_hop_distances(cf, &target_files, outgoing)
    } else {
        HashMap::new()
    };
    let raw_graph: Vec<f32> = vector_results
        .iter()
        .map(|r| {
            hop_distances
                .get(&r.file_path)
                .map(|&d| graph_proximity(d))
                .unwrap_or(0.0)
        })
        .collect();
    let norm_graph = normalize_min_max(&raw_graph);

    // Combine scores
    let mut ranked: Vec<RankedChunk> = vector_results
        .into_iter()
        .enumerate()
        .map(|(i, mut chunk)| {
            let bm25 = norm_bm25.get(i).copied().unwrap_or(0.0);
            let vector = norm_vector.get(i).copied().unwrap_or(0.0);
            let graph = norm_graph.get(i).copied().unwrap_or(0.0);
            chunk.score = combine_scores(bm25, vector, graph, &config);
            chunk
        })
        .collect();

    // Sort by combined score descending
    ranked.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    // Enforce diversity (max 3 chunks per file)
    let diverse = enforce_diversity(ranked, 3);

    diverse.into_iter().take(top_k).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_score_combination() {
        let config = RankConfig {
            alpha: 0.3,
            beta: 0.5,
            gamma: 0.2,
        };
        let score = combine_scores(0.8, 0.6, 0.5, &config);
        let expected = 0.3 * 0.8 + 0.5 * 0.6 + 0.2 * 0.5;
        assert!((score - expected).abs() < 1e-6);
    }

    #[test]
    fn test_normalize_bm25_scores() {
        let scores = vec![2.0, 5.0, 3.0];
        let normalized = normalize_min_max(&scores);
        assert!((normalized[0] - 0.0).abs() < 1e-6); // min
        assert!((normalized[1] - 1.0).abs() < 1e-6); // max
    }

    #[test]
    fn test_graph_proximity() {
        let prox = graph_proximity(0); // current file
        assert!((prox - 1.0).abs() < 1e-6);
        let prox = graph_proximity(1); // 1-hop
        assert!((prox - 0.5).abs() < 1e-6);
        let prox = graph_proximity(2); // 2-hop
        assert!((prox - 1.0 / 3.0).abs() < 1e-6);
    }

    #[test]
    fn test_dedup_same_file_chunks() {
        let results = vec![
            RankedChunk {
                id: "f1-c1".into(),
                file_path: "f1.md".into(),
                score: 0.9,
            },
            RankedChunk {
                id: "f1-c2".into(),
                file_path: "f1.md".into(),
                score: 0.8,
            },
            RankedChunk {
                id: "f1-c3".into(),
                file_path: "f1.md".into(),
                score: 0.7,
            },
            RankedChunk {
                id: "f1-c4".into(),
                file_path: "f1.md".into(),
                score: 0.6,
            },
            RankedChunk {
                id: "f2-c1".into(),
                file_path: "f2.md".into(),
                score: 0.5,
            },
        ];
        let deduped = enforce_diversity(results, 3); // max 3 per file
        assert_eq!(deduped.iter().filter(|r| r.file_path == "f1.md").count(), 3);
    }

    #[test]
    fn test_auto_weight_for_keyword_query() {
        let weights = auto_weights("JWT 토큰 갱신");
        assert!(weights.alpha > weights.beta); // BM25 favored for keyword
    }

    #[test]
    fn test_auto_weight_for_semantic_query() {
        let weights = auto_weights("인증 전략에 대해 알려줘");
        assert!(weights.beta > weights.alpha); // vector favored for semantic
    }

    #[test]
    fn test_normalize_empty() {
        let normalized = normalize_min_max(&[]);
        assert!(normalized.is_empty());
    }

    #[test]
    fn test_normalize_single_value() {
        let normalized = normalize_min_max(&[5.0]);
        assert_eq!(normalized, vec![0.0]);
    }

    #[test]
    fn test_bm25_score_chunk_basic() {
        let score = bm25_score_chunk("JWT token", "The JWT token is used for authentication.");
        assert!(score > 0.0);
    }

    #[test]
    fn test_bm25_score_chunk_no_match() {
        let score = bm25_score_chunk("quantum physics", "How to bake a chocolate cake.");
        assert!((score - 0.0).abs() < 1e-6);
    }

    #[test]
    fn test_bm25_score_chunk_empty() {
        assert!((bm25_score_chunk("test", "") - 0.0).abs() < 1e-6);
        assert!((bm25_score_chunk("", "content") - 0.0).abs() < 1e-6);
    }

    #[test]
    fn test_compute_hop_distances() {
        let mut outgoing: HashMap<String, Vec<String>> = HashMap::new();
        outgoing.insert("a.md".into(), vec!["b.md".into(), "c.md".into()]);
        outgoing.insert("b.md".into(), vec!["d.md".into()]);

        let targets = vec![
            "a.md".into(),
            "b.md".into(),
            "c.md".into(),
            "d.md".into(),
            "e.md".into(),
        ];
        let distances = compute_hop_distances("a.md", &targets, &outgoing);

        assert_eq!(distances.get("a.md"), Some(&0)); // self
        assert_eq!(distances.get("b.md"), Some(&1)); // 1-hop
        assert_eq!(distances.get("c.md"), Some(&1)); // 1-hop
        assert_eq!(distances.get("d.md"), Some(&2)); // 2-hop via b
        assert_eq!(distances.get("e.md"), None); // unreachable
    }

    #[test]
    fn test_hybrid_rank_combines_scores() {
        let vector_results = vec![
            RankedChunk {
                id: "c1".into(),
                file_path: "auth.md".into(),
                score: 0.9,
            },
            RankedChunk {
                id: "c2".into(),
                file_path: "config.md".into(),
                score: 0.7,
            },
        ];
        let vector_scores = vec![0.9, 0.7];
        let mut contents = HashMap::new();
        contents.insert("c1".into(), "JWT token authentication middleware".into());
        contents.insert("c2".into(), "Application configuration settings".into());
        let outgoing = HashMap::new();

        let ranked = hybrid_rank(
            "JWT token",
            vector_results,
            &vector_scores,
            &contents,
            None,
            &outgoing,
            10,
        );

        assert_eq!(ranked.len(), 2);
        // c1 should rank higher (matches query in both vector and BM25)
        assert_eq!(ranked[0].id, "c1");
    }

    #[test]
    fn test_enforce_diversity_all_different_files() {
        let results = vec![
            RankedChunk {
                id: "a".into(),
                file_path: "f1.md".into(),
                score: 0.9,
            },
            RankedChunk {
                id: "b".into(),
                file_path: "f2.md".into(),
                score: 0.8,
            },
            RankedChunk {
                id: "c".into(),
                file_path: "f3.md".into(),
                score: 0.7,
            },
        ];
        let deduped = enforce_diversity(results, 1);
        assert_eq!(deduped.len(), 3);
    }
}
