// §11.4.3 Hybrid Ranker — BM25 + vector + graph scoring with diversity enforcement

use std::collections::HashMap;

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
