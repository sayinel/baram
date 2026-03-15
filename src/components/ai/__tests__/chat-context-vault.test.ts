// §11.4 @vault reference and Knowledge Q&A detection tests
import { describe, expect, it } from "vitest";

import {
  isVaultQuery,
  parseReferences,
  resolveReference,
} from "../../../utils/chat-context";

describe("chat-context @vault support", () => {
  describe("parseReferences", () => {
    it("parses @vault reference", () => {
      expect(parseReferences("@vault 이 프로젝트의 인증 로직은?")).toEqual([
        "@vault",
      ]);
    });

    it("parses @vault alongside other references", () => {
      const refs = parseReferences("@vault @current 인증 로직 설명해줘");
      expect(refs).toContain("@vault");
      expect(refs).toContain("@current");
    });

    it("does not parse vault without @ prefix", () => {
      expect(parseReferences("vault search")).toEqual([]);
    });
  });

  describe("resolveReference @vault", () => {
    it("returns vault placeholder for @vault", () => {
      const result = resolveReference("@vault");
      expect(result).not.toBeNull();
      expect(result!.type).toBe("@vault");
      expect(result!.label).toBe("Vault Search");
    });
  });

  describe("isVaultQuery", () => {
    it("detects @vault reference", () => {
      expect(isVaultQuery("@vault 인증 로직")).toBe(true);
    });

    it("detects Korean keyword heuristics", () => {
      expect(isVaultQuery("이 프로젝트에서 인증은 어떻게 구현되어 있어?")).toBe(
        true,
      );
      expect(isVaultQuery("JWT 검증 로직이 어디에 있어?")).toBe(true);
      expect(isVaultQuery("에러 핸들링 패턴 찾아줘")).toBe(true);
    });

    it("returns false for normal queries without vault keywords", () => {
      expect(isVaultQuery("이 코드를 리팩토링 해줘")).toBe(false);
      expect(isVaultQuery("@current 요약해줘")).toBe(false);
    });
  });
});
