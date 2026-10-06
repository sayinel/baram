import type { SlashMenuItem } from "../../components/command/slash-menu-item";
import type { Editor } from "@tiptap/core";

import { livePluginEntrySource } from "../../plugins/plugin-entry-points";
import { isFeatureEnabled } from "../../stores/settings/features";
import { buildAdvancedItems } from "./slash-command-items-advanced";
import { buildAIItems, buildCustomAIItems } from "./slash-command-items-ai";
import { buildBasicItems } from "./slash-command-items-basic";
import { buildJournalItems } from "./slash-command-items-journal";
import { buildMediaItems } from "./slash-command-items-media";
import { buildPluginSlashItems } from "./slash-command-items-plugins";
import { buildRichContentItems } from "./slash-command-items-rich";
import { buildTaskItems } from "./slash-command-items-tasks";

export function buildSlashItems(editor: Editor): SlashMenuItem[] {
  // §338 꺼진 기능의 그룹은 목록에 없다.
  //
  // ‼️ **순서를 바꾸지 않는다.** 아래 `buildCustomAIItems` 주석대로 배열 위치가 각
  // 항목의 `flatIdx` 를 고정하고 화살표 순회가 그 순서에 의존한다. 조건부 제거는
  // 순서를 보존하지만 재배열은 계약 위반이다.
  //
  // §391 — 플러그인 항목은 **맨 끝**이다(스펙 0070 §7). 플러그인이 켜지고 꺼져도 앞의
  // 내장 항목의 `flatIdx` 가 움직이지 않는다. 그 앞으로 옮기지 않는다.
  const ai = isFeatureEnabled("ai");
  return [
    ...buildBasicItems(editor),
    ...buildRichContentItems(editor),
    ...buildMediaItems(editor),
    ...buildAdvancedItems(editor),
    ...(isFeatureEnabled("tasks") ? buildTaskItems(editor) : []),
    ...(ai ? buildAIItems(editor) : []),
    ...(isFeatureEnabled("journal") ? buildJournalItems(editor) : []),
    // §48 custom AI commands render inside the "AI" group (category: "AI"),
    // but sit here — AFTER journal — in array order. See the comment on
    // buildCustomAIItems itself: this position fixes each item's flatIdx,
    // and Arrow-key traversal depends on that array order, not the group a
    // category renders under. Do not move this call next to buildAIItems.
    ...(ai ? buildCustomAIItems(editor) : []),
    // §391 spec 0070 §7 — LAST, after every built-in group (see the contract above).
    ...buildPluginSlashItems(livePluginEntrySource()),
  ];
}
