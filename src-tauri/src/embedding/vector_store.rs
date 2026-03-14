// §11.4.2 Vector Store — in-memory brute-force vector search with binary persistence

use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::Path;

/// Result of a vector search.
#[derive(Debug, Clone)]
pub struct SearchResult {
    pub id: String,
    pub score: f32,
}

/// Entry in the vector store.
#[derive(Debug, Clone)]
struct VectorEntry {
    id: String,
    file_path: Option<String>,
    vector: Vec<f32>,
}

/// In-memory vector store with brute-force cosine similarity search.
pub struct VectorStore {
    entries: Vec<VectorEntry>,
    id_index: HashMap<String, usize>,
}

impl VectorStore {
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
            id_index: HashMap::new(),
        }
    }

    /// Add a vector with an ID.
    pub fn add(&mut self, id: &str, vector: Vec<f32>) {
        self.remove_by_id(id);
        let idx = self.entries.len();
        self.entries.push(VectorEntry {
            id: id.to_string(),
            file_path: None,
            vector,
        });
        self.id_index.insert(id.to_string(), idx);
    }

    /// Add a vector with an ID and associated file path.
    pub fn add_with_file(&mut self, id: &str, vector: Vec<f32>, file_path: &str) {
        self.remove_by_id(id);
        let idx = self.entries.len();
        self.entries.push(VectorEntry {
            id: id.to_string(),
            file_path: Some(file_path.to_string()),
            vector,
        });
        self.id_index.insert(id.to_string(), idx);
    }

    /// Remove a vector by ID.
    fn remove_by_id(&mut self, id: &str) {
        if let Some(&idx) = self.id_index.get(id) {
            self.entries.remove(idx);
            self.id_index.remove(id);
            // Rebuild index for entries after the removed one
            for (i, entry) in self.entries.iter().enumerate().skip(idx) {
                self.id_index.insert(entry.id.clone(), i);
            }
        }
    }

    /// Remove all vectors associated with a file path.
    pub fn remove_by_file(&mut self, file_path: &str) {
        let ids_to_remove: Vec<String> = self
            .entries
            .iter()
            .filter(|e| e.file_path.as_deref() == Some(file_path))
            .map(|e| e.id.clone())
            .collect();
        for id in ids_to_remove {
            self.remove_by_id(&id);
        }
    }

    /// Search for the top-k most similar vectors.
    pub fn search(&self, query: &[f32], top_k: usize) -> Vec<SearchResult> {
        let mut scores: Vec<(usize, f32)> = self
            .entries
            .iter()
            .enumerate()
            .map(|(i, entry)| (i, cosine_similarity(query, &entry.vector)))
            .collect();

        scores.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

        scores
            .into_iter()
            .take(top_k)
            .map(|(i, score)| SearchResult {
                id: self.entries[i].id.clone(),
                score,
            })
            .collect()
    }

    /// Number of entries in the store.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Check if the store is empty.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Save the vector store to a binary file.
    ///
    /// Format:
    /// - u32: number of entries
    /// - For each entry:
    ///   - u32: id length, then id bytes
    ///   - u8: has_file_path (0 or 1)
    ///   - if has_file_path: u32: file_path length, then file_path bytes
    ///   - u32: vector dimension
    ///   - f32 * dimension: vector values
    pub fn save(&self, dir: &Path) -> Result<(), String> {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let path = dir.join("vectors.bin");
        let mut file = fs::File::create(&path).map_err(|e| e.to_string())?;

        let count = self.entries.len() as u32;
        file.write_all(&count.to_le_bytes())
            .map_err(|e| e.to_string())?;

        for entry in &self.entries {
            // Write ID
            let id_bytes = entry.id.as_bytes();
            let id_len = id_bytes.len() as u32;
            file.write_all(&id_len.to_le_bytes())
                .map_err(|e| e.to_string())?;
            file.write_all(id_bytes).map_err(|e| e.to_string())?;

            // Write file_path
            match &entry.file_path {
                Some(fp) => {
                    file.write_all(&[1u8]).map_err(|e| e.to_string())?;
                    let fp_bytes = fp.as_bytes();
                    let fp_len = fp_bytes.len() as u32;
                    file.write_all(&fp_len.to_le_bytes())
                        .map_err(|e| e.to_string())?;
                    file.write_all(fp_bytes).map_err(|e| e.to_string())?;
                }
                None => {
                    file.write_all(&[0u8]).map_err(|e| e.to_string())?;
                }
            }

            // Write vector
            let dim = entry.vector.len() as u32;
            file.write_all(&dim.to_le_bytes())
                .map_err(|e| e.to_string())?;
            for &val in &entry.vector {
                file.write_all(&val.to_le_bytes())
                    .map_err(|e| e.to_string())?;
            }
        }

        Ok(())
    }

    /// Load a vector store from a binary file.
    pub fn load(dir: &Path) -> Result<Self, String> {
        let path = dir.join("vectors.bin");
        if !path.exists() {
            return Ok(Self::new());
        }

        let mut file = fs::File::open(&path).map_err(|e| e.to_string())?;
        let mut store = Self::new();

        let mut buf4 = [0u8; 4];
        file.read_exact(&mut buf4).map_err(|e| e.to_string())?;
        let count = u32::from_le_bytes(buf4) as usize;

        for _ in 0..count {
            // Read ID
            file.read_exact(&mut buf4).map_err(|e| e.to_string())?;
            let id_len = u32::from_le_bytes(buf4) as usize;
            let mut id_bytes = vec![0u8; id_len];
            file.read_exact(&mut id_bytes).map_err(|e| e.to_string())?;
            let id = String::from_utf8(id_bytes).map_err(|e| e.to_string())?;

            // Read file_path
            let mut flag = [0u8; 1];
            file.read_exact(&mut flag).map_err(|e| e.to_string())?;
            let file_path = if flag[0] == 1 {
                file.read_exact(&mut buf4).map_err(|e| e.to_string())?;
                let fp_len = u32::from_le_bytes(buf4) as usize;
                let mut fp_bytes = vec![0u8; fp_len];
                file.read_exact(&mut fp_bytes).map_err(|e| e.to_string())?;
                Some(String::from_utf8(fp_bytes).map_err(|e| e.to_string())?)
            } else {
                None
            };

            // Read vector
            file.read_exact(&mut buf4).map_err(|e| e.to_string())?;
            let dim = u32::from_le_bytes(buf4) as usize;
            let mut vector = Vec::with_capacity(dim);
            for _ in 0..dim {
                file.read_exact(&mut buf4).map_err(|e| e.to_string())?;
                vector.push(f32::from_le_bytes(buf4));
            }

            let idx = store.entries.len();
            store.entries.push(VectorEntry {
                id: id.clone(),
                file_path,
                vector,
            });
            store.id_index.insert(id, idx);
        }

        Ok(store)
    }
}

/// Compute cosine similarity between two vectors.
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }

    let mut dot = 0.0f32;
    let mut norm_a = 0.0f32;
    let mut norm_b = 0.0f32;

    for (x, y) in a.iter().zip(b.iter()) {
        dot += x * y;
        norm_a += x * x;
        norm_b += y * y;
    }

    let denom = norm_a.sqrt() * norm_b.sqrt();
    if denom == 0.0 {
        return 0.0;
    }

    dot / denom
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_add_and_search() {
        let mut store = VectorStore::new();
        store.add("chunk-1", vec![1.0, 0.0, 0.0]);
        store.add("chunk-2", vec![0.0, 1.0, 0.0]);
        store.add("chunk-3", vec![0.9, 0.1, 0.0]);

        let results = store.search(&[1.0, 0.0, 0.0], 2);
        assert_eq!(results[0].id, "chunk-1");
        assert_eq!(results[1].id, "chunk-3");
    }

    #[test]
    fn test_remove_by_file() {
        let mut store = VectorStore::new();
        store.add_with_file("c1", vec![1.0], "file1.md");
        store.add_with_file("c2", vec![0.5], "file1.md");
        store.add_with_file("c3", vec![0.3], "file2.md");
        store.remove_by_file("file1.md");
        assert_eq!(store.len(), 1);
    }

    #[test]
    fn test_cosine_similarity() {
        let sim = cosine_similarity(&[1.0, 0.0], &[1.0, 0.0]);
        assert!((sim - 1.0).abs() < 1e-6);

        let sim = cosine_similarity(&[1.0, 0.0], &[0.0, 1.0]);
        assert!(sim.abs() < 1e-6);
    }

    #[test]
    fn test_save_and_load() {
        let dir = tempfile::TempDir::new().unwrap();
        let mut store = VectorStore::new();
        store.add("c1", vec![1.0, 2.0, 3.0]);
        store.save(dir.path()).unwrap();

        let loaded = VectorStore::load(dir.path()).unwrap();
        assert_eq!(loaded.len(), 1);
        let results = loaded.search(&[1.0, 2.0, 3.0], 1);
        assert_eq!(results[0].id, "c1");
    }

    #[test]
    fn test_cosine_similarity_identical() {
        let sim = cosine_similarity(&[3.0, 4.0], &[3.0, 4.0]);
        assert!((sim - 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_cosine_similarity_opposite() {
        let sim = cosine_similarity(&[1.0, 0.0], &[-1.0, 0.0]);
        assert!((sim - (-1.0)).abs() < 1e-6);
    }

    #[test]
    fn test_empty_store_search() {
        let store = VectorStore::new();
        let results = store.search(&[1.0, 0.0], 5);
        assert!(results.is_empty());
    }

    #[test]
    fn test_save_and_load_with_file_path() {
        let dir = tempfile::TempDir::new().unwrap();
        let mut store = VectorStore::new();
        store.add_with_file("c1", vec![1.0, 2.0], "test.md");
        store.add("c2", vec![3.0, 4.0]);
        store.save(dir.path()).unwrap();

        let loaded = VectorStore::load(dir.path()).unwrap();
        assert_eq!(loaded.len(), 2);
    }

    #[test]
    fn test_load_nonexistent() {
        let dir = tempfile::TempDir::new().unwrap();
        let loaded = VectorStore::load(dir.path()).unwrap();
        assert_eq!(loaded.len(), 0);
    }
}
