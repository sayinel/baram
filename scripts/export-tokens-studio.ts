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

const primitiveColor = JSON.parse(
  fs.readFileSync(path.join(tokensDir, "primitive/color.json"), "utf-8"),
);
const primitiveSpacing = JSON.parse(
  fs.readFileSync(path.join(tokensDir, "primitive/spacing.json"), "utf-8"),
);
const primitiveTypography = JSON.parse(
  fs.readFileSync(path.join(tokensDir, "primitive/typography.json"), "utf-8"),
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
    ...dtcgToTokensStudio(primitiveColor),
    ...dtcgToTokensStudio(primitiveSpacing),
    ...dtcgToTokensStudio(primitiveTypography),
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
