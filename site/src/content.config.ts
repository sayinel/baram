// Starlight 콘텐츠 컬렉션.
// docs = 문서 본문 (src/content/docs/{en,ko}/docs/**), i18n = Starlight UI 문자열 ko 오버라이드.
import { docsLoader, i18nLoader } from "@astrojs/starlight/loaders";
import { docsSchema, i18nSchema } from "@astrojs/starlight/schema";
import { defineCollection } from "astro:content";
import { z } from "astro/zod";

import { SOURCE_HASH_LENGTH } from "./lib/source-hash.ts";

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      extend: z.object({
        /**
         * 번역이 만들어진 시점의 **원문(en) title + 본문** 해시.
         * 빌드가 원문을 다시 해시해 대조하고, 다르면 "원문보다 낡음" 배너를 낸다.
         * ko 파일에만 쓴다. en 에 있으면 무의미하므로 게이트가 잡는다.
         */
        sourceHash: z
          .string()
          .regex(
            new RegExp(`^[0-9a-f]{${SOURCE_HASH_LENGTH}}$`),
            `sourceHash 는 16진수 ${SOURCE_HASH_LENGTH}자리여야 합니다 — 오타가 난 스탬프는 ` +
              `어떤 원문과도 일치하지 않아 그 페이지에 낡음 배너가 영구히 붙고, 게이트는 ` +
              `그것을 "낡음(결함 아님)"으로 셉니다. 여기서 파일 이름을 대고 실패시킵니다.`,
          )
          .optional(),
      }),
    }),
  }),
  i18n: defineCollection({
    loader: i18nLoader(),
    schema: i18nSchema({
      // 낡은 번역 배너의 문구. Starlight 기본 사전에 없는 키라 두 로케일이 직접 낸다.
      extend: z.object({
        "translation.stale": z.string().optional(),
        "translation.viewSource": z.string().optional(),
      }),
    }),
  }),
};
