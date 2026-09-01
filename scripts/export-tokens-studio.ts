/**
 * Exports design tokens to Tokens Studio (Figma plugin) format.
 * Run: npx tsx scripts/export-tokens-studio.ts
 */
import fs from "fs";
import path from "path";

interface DtcgToken {
  $value: string;
  $type?: string;
  $description?: string;
}

interface DtcgGroup {
  [key: string]: DtcgToken | DtcgGroup | string;
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

// Build Tokens Studio structure
const tokensStudio = {
  primitive: {
    ...Object.assign({}, ...primitives.map((file) => dtcgToTokensStudio(file))),
  },
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
