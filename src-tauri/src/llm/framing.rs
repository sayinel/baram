// §6.3 Byte line framing shared by the streaming providers (issue 264).
//
// The providers used to turn every network chunk into text with
// `String::from_utf8_lossy` and split lines in a `String`. A chunk boundary
// that falls inside a multi-byte character — three bytes for 한글, four for an
// emoji — made both halves invalid on their own, and lossy decoding replaced
// them with U+FFFD for good; the damaged JSON then failed to parse and was
// dropped without a word. Splitting the remaining buffer with `to_string()`
// per line also copied the whole tail once per record.
//
// This decoder keeps BYTES and hands out complete records only. A record ends
// at `\n` (an optional `\r` before it is stripped), and `0x0A` never occurs
// inside a UTF-8 multi-byte sequence, so a complete record is either valid
// UTF-8 or genuinely malformed — never "cut in half". SSE and NDJSON both frame
// on newlines, so the line is the unit every provider parser already wanted.
// What the record MEANS (`data:`, `event:`, `{"done":true}`) stays with the
// provider.
use thiserror::Error;

/// Longest unterminated record the decoder will hold before giving up: a
/// provider that stops sending newlines must not grow the buffer without
/// bound. SSE data records are a few hundred bytes; 1 MiB is generous.
pub const DEFAULT_MAX_RECORD: usize = 1024 * 1024;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum FramingError {
    #[error("record is not valid UTF-8 (valid up to byte {valid_up_to})")]
    InvalidUtf8 { valid_up_to: usize },
    #[error("record of {len} bytes exceeds the {max}-byte limit without a line break")]
    RecordTooLong { len: usize, max: usize },
}

/// What one complete record meant to a provider parser. Records that carry
/// nothing for the frontend (SSE comments, `event:` lines, keepalives) yield
/// an empty list, not a variant.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum LineEvent {
    /// A piece of generated text.
    Token(String),
    /// The provider's terminal record: the completion is finished.
    Done,
}

/// Why a provider parser refused a record. Neither carries the record body —
/// generated text must not reach the log file (logging/mod.rs).
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ParseFailure {
    /// A record the protocol does not allow: unparsable JSON, an unknown SSE
    /// field. `detail` names the category and the record's length, not its
    /// content.
    Malformed(String),
    /// A well-formed record in which the provider reports an error — a quota,
    /// an overload, a bad request. The provider's message, which describes
    /// the failure, not the document.
    Provider(String),
}

/// Accumulates stream bytes and yields complete lines as `&str`.
///
/// Consumed bytes are dropped by compacting the buffer only once the consumed
/// prefix is at least half of it, so a burst of small records costs amortised
/// O(1) per record instead of one copy of the whole tail each.
#[derive(Debug)]
pub struct LineDecoder {
    buf: Vec<u8>,
    /// Index of the first unconsumed byte.
    start: usize,
    /// Length of the record still open at the end of `buf` (no newline yet).
    /// Carried across pushes so the bound is checked on the NEW bytes only —
    /// rescanning the whole open record per chunk would be quadratic for an
    /// endpoint that dribbles a newline-free record one byte at a time.
    open_len: usize,
    /// Every byte in `buf[start..scan]` is known to be no newline, so
    /// `next_line` resumes searching there instead of from `start` — the
    /// same dribbling endpoint would otherwise make each search rescan the
    /// whole open record.
    scan: usize,
    max_record: usize,
    /// Bytes `next_line` examined in total (tests pin it at O(bytes pushed)).
    #[cfg(test)]
    scanned: usize,
}

impl Default for LineDecoder {
    fn default() -> Self {
        Self::new(DEFAULT_MAX_RECORD)
    }
}

impl LineDecoder {
    pub fn new(max_record: usize) -> Self {
        Self {
            buf: Vec::new(),
            start: 0,
            open_len: 0,
            scan: 0,
            max_record,
            #[cfg(test)]
            scanned: 0,
        }
    }

    /// Appends a network chunk. Fails when any record — terminated in this
    /// chunk or still open — exceeds the record limit; the decoder is not
    /// usable after that. This bounds what the decoder RETAINS; the chunk
    /// itself was already allocated by the HTTP client before it got here.
    pub fn push(&mut self, chunk: &[u8]) -> Result<(), FramingError> {
        // Walk only the new bytes: each newline closes the open record (whose
        // length is `open_len` plus what this chunk added), the bytes after
        // the last newline become the new open record.
        let mut open = self.open_len;
        for (i, segment) in chunk.split(|&b| b == b'\n').enumerate() {
            let len = if i == 0 {
                open + segment.len()
            } else {
                segment.len()
            };
            if len > self.max_record {
                return Err(FramingError::RecordTooLong {
                    len,
                    max: self.max_record,
                });
            }
            open = len;
        }
        self.open_len = open;
        self.buf.extend_from_slice(chunk);
        Ok(())
    }

    /// The next complete line without its terminator, or `None` when no
    /// complete line is buffered yet.
    pub fn next_line(&mut self) -> Option<Result<&str, FramingError>> {
        self.maybe_compact();
        let from = self.scan.max(self.start);
        let found = self.buf[from..].iter().position(|&b| b == b'\n');
        #[cfg(test)]
        {
            self.scanned += found.map_or(self.buf.len() - from, |p| p + 1);
        }
        let Some(rel) = found else {
            // Nothing complete yet; remember how far we looked.
            self.scan = self.buf.len();
            return None;
        };
        let record_start = self.start;
        let end = from + rel;
        self.start = end + 1;
        self.scan = self.start;
        Some(decode_record(&self.buf[record_start..end]))
    }

    /// The bytes left after the stream ended, as one final record — NDJSON
    /// streams may omit the last newline. `None` when nothing is left.
    pub fn finish(&mut self) -> Option<Result<&str, FramingError>> {
        if self.start >= self.buf.len() {
            return None;
        }
        let record_start = self.start;
        self.start = self.buf.len();
        Some(decode_record(&self.buf[record_start..]))
    }

    /// Bytes buffered but not yet consumed (tests: the buffer stays bounded).
    #[cfg(test)]
    pub fn buffered_len(&self) -> usize {
        self.buf.len() - self.start
    }

    fn maybe_compact(&mut self) {
        if self.start > 0 && self.start >= self.buf.len() / 2 {
            self.buf.drain(..self.start);
            self.scan = self.scan.saturating_sub(self.start);
            self.start = 0;
        }
    }
}

/// The payload of an SSE `data:` line, or `None` for every other line. The
/// SSE grammar says a field the client does not know is ignored — blank
/// separators, `:` comments and keepalives, `event:`/`id:`/`retry:`, and
/// extension fields a proxy or compatible server may add (`x-metadata: 1`)
/// all carry no event. Strictness lives in the DATA: its UTF-8 was checked
/// by the decoder and its JSON is checked by the provider; a stream that is
/// not SSE at all never produces a terminal record and ends as an
/// IncompleteStream error rather than being mistaken for success.
pub(crate) fn sse_data(line: &str) -> Option<&str> {
    let rest = line.strip_prefix("data:")?;
    Some(rest.strip_prefix(' ').unwrap_or(rest))
}

/// A data record that is not the JSON the provider promised. Names the size,
/// serde's error category and position — NOT serde's message, whose Display
/// quotes the offending value for type errors (`invalid type: string "…"`),
/// which would carry document text into `llm:error`.
pub(crate) fn malformed_json(data: &str, error: &serde_json::Error) -> ParseFailure {
    let category = match error.classify() {
        serde_json::error::Category::Io => "io",
        serde_json::error::Category::Syntax => "syntax",
        serde_json::error::Category::Data => "data",
        serde_json::error::Category::Eof => "eof",
    };
    ParseFailure::Malformed(format!(
        "unparsable JSON data record ({} bytes): {category} error at line {} column {}",
        data.len(),
        error.line(),
        error.column()
    ))
}

fn decode_record(mut record: &[u8]) -> Result<&str, FramingError> {
    if let [rest @ .., b'\r'] = record {
        record = rest;
    }
    std::str::from_utf8(record).map_err(|e| FramingError::InvalidUtf8 {
        valid_up_to: e.valid_up_to(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKENS: [&str; 4] = ["한", "글", "🙂", "한글🙂"];

    fn transcript(sep: &str) -> Vec<u8> {
        TOKENS
            .iter()
            .map(|t| format!("data: {{\"t\":\"{t}\"}}{sep}{sep}"))
            .collect::<String>()
            .into_bytes()
    }

    fn expected_lines(sep: &str) -> Vec<String> {
        let text = String::from_utf8(transcript(sep)).unwrap();
        let mut lines: Vec<String> = text
            .split('\n')
            .map(|l| l.trim_end_matches('\r').to_string())
            .collect();
        // `split` yields one trailing "" after the final newline.
        assert_eq!(lines.pop().as_deref(), Some(""));
        lines
    }

    fn drain(decoder: &mut LineDecoder, out: &mut Vec<String>) {
        while let Some(line) = decoder.next_line() {
            out.push(line.expect("valid record").to_string());
        }
    }

    fn feed_in_chunks(
        bytes: &[u8],
        chunks: impl Iterator<Item = std::ops::Range<usize>>,
    ) -> Vec<String> {
        let mut decoder = LineDecoder::default();
        let mut out = Vec::new();
        for r in chunks {
            decoder.push(&bytes[r]).unwrap();
            drain(&mut decoder, &mut out);
        }
        if let Some(rest) = decoder.finish() {
            out.push(rest.unwrap().to_string());
        }
        out
    }

    #[test]
    fn a_split_at_every_byte_offset_preserves_every_record() {
        let bytes = transcript("\n");
        let expected = expected_lines("\n");
        for split in 0..=bytes.len() {
            let got = feed_in_chunks(&bytes, [0..split, split..bytes.len()].into_iter());
            assert_eq!(got, expected, "split at byte {split}");
        }
    }

    #[test]
    fn one_byte_at_a_time_preserves_every_record() {
        let bytes = transcript("\n");
        let got = feed_in_chunks(&bytes, (0..bytes.len()).map(|i| i..i + 1));
        assert_eq!(got, expected_lines("\n"));
    }

    #[test]
    fn crlf_terminators_are_stripped_even_when_the_pair_is_split() {
        let bytes = transcript("\r\n");
        let expected = expected_lines("\r\n");
        for split in 0..=bytes.len() {
            let got = feed_in_chunks(&bytes, [0..split, split..bytes.len()].into_iter());
            assert_eq!(got, expected, "split at byte {split}");
        }
    }

    #[test]
    fn many_records_in_one_chunk_and_one_record_over_many_chunks() {
        let mut decoder = LineDecoder::default();
        let mut out = Vec::new();
        decoder.push(b"a\nb\nc\n").unwrap();
        drain(&mut decoder, &mut out);
        assert_eq!(out, ["a", "b", "c"]);
        out.clear();
        for piece in [&b"lon"[..], b"g re", b"cord", b"\n"] {
            decoder.push(piece).unwrap();
            drain(&mut decoder, &mut out);
        }
        assert_eq!(out, ["long record"]);
    }

    #[test]
    fn the_eof_remainder_is_a_final_record() {
        let mut decoder = LineDecoder::default();
        decoder.push(b"{\"done\":false}\n{\"done\":true}").unwrap();
        let mut out = Vec::new();
        drain(&mut decoder, &mut out);
        assert_eq!(out, ["{\"done\":false}"]);
        assert_eq!(decoder.finish().unwrap().unwrap(), "{\"done\":true}");
        assert!(decoder.finish().is_none());
    }

    #[test]
    fn empty_lines_come_through_as_empty_records() {
        // SSE separates events with a blank line; the provider decides what an
        // empty record means, the decoder must not eat it.
        let mut decoder = LineDecoder::default();
        decoder.push(b"data: x\n\ndata: y\n").unwrap();
        let mut out = Vec::new();
        drain(&mut decoder, &mut out);
        assert_eq!(out, ["data: x", "", "data: y"]);
    }

    #[test]
    fn invalid_utf8_is_an_error_not_a_replacement_character() {
        let mut decoder = LineDecoder::default();
        decoder.push(b"ok\n\xE1\x95\n").unwrap(); // truncated 한 (E1 95 9C)
        assert_eq!(decoder.next_line().unwrap().unwrap(), "ok");
        assert_eq!(
            decoder.next_line().unwrap(),
            Err(FramingError::InvalidUtf8 { valid_up_to: 0 })
        );
    }

    #[test]
    fn an_unterminated_record_over_the_limit_is_refused() {
        let mut decoder = LineDecoder::new(8);
        decoder.push(b"12345678").unwrap();
        assert_eq!(
            decoder.push(b"9"),
            Err(FramingError::RecordTooLong { len: 9, max: 8 })
        );
        // A newline resets the tail measurement.
        let mut decoder = LineDecoder::new(8);
        decoder.push(b"12345678\n1234").unwrap();
    }

    #[test]
    fn a_terminated_record_over_the_limit_is_refused_too() {
        // The bound is on records, not on the unterminated tail: a huge
        // record that happens to end with a newline is still refused.
        let mut decoder = LineDecoder::new(8);
        assert_eq!(
            decoder.push(b"123456789\n"),
            Err(FramingError::RecordTooLong { len: 9, max: 8 })
        );
        let mut decoder = LineDecoder::new(8);
        assert_eq!(
            decoder.push(b"123456789\nab"),
            Err(FramingError::RecordTooLong { len: 9, max: 8 })
        );
        // Many small records in one big chunk are fine.
        let mut decoder = LineDecoder::new(8);
        let chunk = b"1234567\n".repeat(1000);
        decoder.push(&chunk).unwrap();
    }

    #[test]
    fn the_bound_is_enforced_on_a_record_dribbled_one_byte_at_a_time() {
        // No newline ever arrives: the open record grows by one byte per
        // push and must be refused exactly when it passes the limit — the
        // check is incremental, not a rescan of everything buffered.
        let mut decoder = LineDecoder::new(64);
        for i in 0..64 {
            decoder
                .push(b"x")
                .unwrap_or_else(|e| panic!("byte {i}: {e}"));
            assert!(decoder.next_line().is_none());
        }
        assert_eq!(
            decoder.push(b"x"),
            Err(FramingError::RecordTooLong { len: 65, max: 64 })
        );
    }

    #[test]
    fn a_newline_in_a_later_chunk_closes_the_open_record_for_the_bound() {
        let mut decoder = LineDecoder::new(8);
        decoder.push(b"12345").unwrap();
        decoder
            .push(
                b"678
1234",
            )
            .unwrap(); // closes an 8-byte record, opens a 4-byte one
        assert_eq!(decoder.next_line().unwrap().unwrap(), "12345678");
        decoder.push(b"5678").unwrap(); // the open record reaches exactly 8
        assert_eq!(
            decoder.push(b"9"),
            Err(FramingError::RecordTooLong { len: 9, max: 8 })
        );
    }

    #[test]
    fn searching_for_a_newline_examines_each_byte_once() {
        // The provider loop calls next_line after every chunk. A dribbled
        // record must not make each call rescan the whole open record: the
        // bytes examined in total stay proportional to the bytes pushed.
        let mut decoder = LineDecoder::default();
        let n = 10_000;
        for _ in 0..n {
            decoder.push(b"x").unwrap();
            assert!(decoder.next_line().is_none());
        }
        assert!(
            decoder.scanned <= n,
            "scanned {} bytes for {n} pushed",
            decoder.scanned
        );
        decoder.push(b"\n").unwrap();
        assert_eq!(decoder.next_line().unwrap().unwrap().len(), n);
        assert!(decoder.scanned <= n + 1, "scanned {}", decoder.scanned);
        // And compaction keeps the cursor honest.
        decoder.push(b"ab\ncd").unwrap();
        assert_eq!(decoder.next_line().unwrap().unwrap(), "ab");
        assert!(decoder.next_line().is_none());
        decoder.push(b"\n").unwrap();
        assert_eq!(decoder.next_line().unwrap().unwrap(), "cd");
    }

    #[test]
    fn the_buffer_does_not_grow_with_the_number_of_records() {
        let mut decoder = LineDecoder::default();
        let line = format!("data: {}\n", "x".repeat(90));
        for _ in 0..10_000 {
            decoder.push(line.as_bytes()).unwrap();
            assert!(decoder.next_line().unwrap().is_ok());
            assert_eq!(decoder.buffered_len(), 0);
        }
        assert!(
            decoder.buf.len() < 2 * line.len(),
            "buf.len() = {}",
            decoder.buf.len()
        );
    }

    /// Why the decoder exists: the lossy path the providers used to run.
    #[test]
    fn the_old_lossy_decoding_breaks_a_character_split_across_chunks() {
        let bytes = "한".as_bytes(); // E1 95 9C
        let mut text = String::new();
        text.push_str(&String::from_utf8_lossy(&bytes[..1]));
        text.push_str(&String::from_utf8_lossy(&bytes[1..]));
        assert!(text.contains('\u{FFFD}'));
        assert_ne!(text, "한");
    }
}
