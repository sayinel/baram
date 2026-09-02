/**
 * Exports design tokens to Tokens Studio (Figma plugin) format.
 * Run: npx tsx scripts/export-tokens-studio.ts
 */
import fs from "fs";
import path from "path";

interface DtcgGroup {
  [key: string]: DtcgGroup | DtcgToken | string;
}

interface DtcgToken {
  $description?: string;
  $type?: string;
  $value: string;
}

function dtcgToTokensStudio(
  tokens: DtcgGroup,
  parentType?: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(tokens)) {
    if (key.startsWith("$")) continue; // skip $type, $description at group level
    if (value && typeof value === "object" && "$value" in value) {
      const token = value as DtcgToken;
      const type = token.$type ?? parentType ?? "other";
      result[key] = {
        value: token.$value,
        type,
        ...(token.$description ? { description: token.$description } : {}),
      };
    } else if (typeof value === "object") {
      const groupType =
        ((value as DtcgGroup).$type as string | undefined) ?? parentType;
      result[key] = dtcgToTokensStudio(value as DtcgGroup, groupType);
    }
  }
  return result;
}

// Read all token files
const tokensDir = path.resolve("tokens");

// 감사 순서 7: primitive 파일 목록을 하드코딩하지 않는다 — Style Dictionary 빌드는
// tokens/primitive/**/*.json 전체를 읽는데 여기만 세 파일을 이름으로 집으면, 새
// primitive 파일(예: shadow.json)이 CSS에는 들어가고 Tokens Studio export에서는
// 조용히 빠진다. tokens:check는 양쪽이 각자 결정적이면 그 드리프트를 못 잡는다.
// 빌드와 같은 표면을 정렬된 순서로 재귀 수집해 병합한다.
const primitiveFiles = fs
  .readdirSync(path.join(tokensDir, "primitive"), { recursive: true })
  .map(String)
  .filter((f) => f.endsWith(".json"))
  .sort();
const primitives = primitiveFiles.map(
  (f) =>
    JSON.parse(
      fs.readFileSync(path.join(tokensDir, "primitive", f), "utf-8"),
    ) as DtcgGroup,
);
const semanticLight = JSON.parse(
  fs.readFileSync(path.join(tokensDir, "semantic/color-light.json"), "utf-8"),
);
const semanticDark = JSON.parse(
  fs.readFileSync(path.join(tokensDir, "semantic/color-dark.json"), "utf-8"),
);

/**
 * primitive 파일들의 재귀 병합 — shallow spread 금지(적대 리뷰).
 * Style Dictionary는 같은 top-key(`color` 등)를 가진 파일들을 deep merge하는데,
 * 여기서 Object.assign으로 합치면 뒤 파일의 `color` 서브트리가 앞 파일 것을
 * **통째로 교체**해 CSS는 멀쩡한데 Figma export에서만 팔레트가 사라진다.
 * 같은 leaf에 서로 다른 값이 오면 조용히 덮지 않고 실패시킨다.
 */
function deepMergeTokens(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  trail: string[] = [],
): Record<string, unknown> {
  for (const [key, value] of Object.entries(source)) {
    // JSON 키가 "__proto__"면 target[key] 접근·대입이 프로토타입을 타서
    // Object.prototype 오염이 실제로 재현됐다(입력이 저장소 내 파일뿐이라
    // 도달 경로는 없지만, 한 줄로 닫히는 구멍이다).
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      throw new Error(`primitive token file uses a forbidden key: ${key}`);
    }
    const existing = target[key];
    if (
      existing &&
      typeof existing === "object" &&
      value &&
      typeof value === "object" &&
      !("value" in (existing as object)) &&
      !("value" in (value as object))
    ) {
      deepMergeTokens(
        existing as Record<string, unknown>,
        value as Record<string, unknown>,
        [...trail, key],
      );
    } else if (existing !== undefined) {
      throw new Error(
        `primitive token collision at '${[...trail, key].join(".")}' — ` +
          `two primitive files define the same leaf (identical values are rejected too - a duplicate belongs in one file)`,
      );
    } else {
      target[key] = value;
    }
  }
  return target;
}

// Build Tokens Studio structure
const tokensStudio = {
  primitive: primitives.reduce<Record<string, unknown>>(
    (acc, file) => deepMergeTokens(acc, dtcgToTokensStudio(file)),
    {},
  ),
  "semantic/light": dtcgToTokensStudio(semanticLight),
  "semantic/dark": dtcgToTokensStudio(semanticDark),
  $metadata: {
    tokenSetOrder: ["primitive", "semantic/light", "semantic/dark"],
  },
  $themes: [
    {
      id: "light",
      name: "Light",
      selectedTokenSets: {
        primitive: "source",
        "semantic/light": "enabled",
      },
    },
    {
      id: "dark",
      name: "Dark",
      selectedTokenSets: {
        primitive: "source",
        "semantic/dark": "enabled",
      },
    },
  ],
};

const outputPath = path.join(tokensDir, "tokens-studio.json");
fs.writeFileSync(outputPath, JSON.stringify(tokensStudio, null, 2) + "\n");
console.log(`Tokens Studio export: ${outputPath}`);
console.log(
  `  Sets: ${Object.keys(tokensStudio).filter((k) => !k.startsWith("$")).length}`,
);
