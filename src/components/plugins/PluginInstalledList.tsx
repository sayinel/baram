// §69 — 하나의 목록 안에서 provenance로 그룹핑한다(JetBrains Bundled/Downloaded 방식).
// 탭을 늘리지 않으므로 좁은 사이드바와 넓은 설정 모달 양쪽에서 같은 구조가 동작한다.
import { useState } from "react";

import type { PluginRow, PluginSource } from "../../plugins/plugin-sources";

import { useTranslation } from "../../i18n/useTranslation";
import { PluginRowView } from "./PluginRow";

interface PluginInstalledListProps {
  /**
   * ‼️ 둘 다 OPTIONAL이며 함께 온다 (사용자 결정 2026-08-06). PR1에는 설정 페이지가 없어
   * 아무도 넘기지 않고, ⚙는 그려지지 않는다. `onSettings` 없이 `hasSettings`만 넘기는 것은
   * 의미가 없으므로 아래에서 두 값이 모두 있을 때만 행에 전달한다.
   */
  hasSettings?: (pluginId: string) => boolean;
  onDetails: (row: PluginRow) => void;
  /**
   * ‼️ OPTIONAL, 같은 이유다 (`onSettings` 참조). PR1의 셸은 dev 섹션을
   * `PluginDeveloperSection`에 남겨 두므로 dev 행을 렌더하지 않고, 따라서 부를 수 없는
   * 콜백을 넘기지 않는다.
   */
  onReload?: (row: PluginRow) => void;
  onRemove: (row: PluginRow) => void;
  onSettings?: (row: PluginRow) => void;
  onToggle: (row: PluginRow) => void;
  onUpdate: (row: PluginRow) => void;
  rows: PluginRow[];
}

/** 표시 순서. `buildPluginRows`도 이 순서로 반환하지만, 표시는 표시가 정한다. */
const ORDER: PluginSource[] = ["builtin", "community", "dev"];

/**
 * 섹션 제목 i18n 키. 템플릿 리터럴 `t(\`plugin.section.${source}\`)`로 조립하면 정적
 * 스캐너(`plugin-ui-i18n.test.tsx`)가 보는 리터럴 조각은 `"plugin.section."`뿐이라
 * en.json의 어떤 키와도 일치하지 않아 하드코딩된 프로즈로 오판된다. `PluginTrustBadge`의
 * `LABEL_KEY` 패턴과 동일하게 완전한 키 문자열로 조회한다.
 */
const SECTION_KEY: Record<PluginSource, string> = {
  builtin: "plugin.section.builtin",
  community: "plugin.section.community",
  dev: "plugin.section.dev",
};

/**
 * 같은 이유로 완전한 문자열을 미리 조립한다: `` `plugin-section-${source}` ``의 리터럴
 * 조각 `"plugin-section-"`는 클래스-리스트 모양 규칙과 일치하지 않아(끝이 하이픈으로
 * 끊김) 스캐너가 프로즈로 오판한다. 완성된 문자열은 그 규칙과 일치한다.
 */
const SECTION_TESTID: Record<PluginSource, string> = {
  builtin: "plugin-section-builtin",
  community: "plugin-section-community",
  dev: "plugin-section-dev",
};

const SECTION_COUNT_TESTID: Record<PluginSource, string> = {
  builtin: "plugin-section-count-builtin",
  community: "plugin-section-count-community",
  dev: "plugin-section-count-dev",
};

export function PluginInstalledList({
  hasSettings,
  onDetails,
  onReload,
  onRemove,
  onSettings,
  onToggle,
  onUpdate,
  rows,
}: PluginInstalledListProps) {
  const { t } = useTranslation();
  // 접기 상태는 영속화하지 않는다 — 영속 키를 하나 더 만들 값어치가 없다.
  const [collapsed, setCollapsed] = useState<Set<PluginSource>>(new Set());

  return (
    <>
      {ORDER.map((source) => {
        const group = rows.filter((r) => r.source === source);
        if (group.length === 0) return null;
        const isCollapsed = collapsed.has(source);
        return (
          <section
            className="plugin-section"
            data-testid={SECTION_TESTID[source]}
            key={source}
          >
            <button
              aria-expanded={!isCollapsed}
              className="plugin-section__head btn-unstyled"
              onClick={() =>
                setCollapsed((cur) => {
                  const next = new Set(cur);
                  if (!next.delete(source)) next.add(source);
                  return next;
                })
              }
              type="button"
            >
              <span className="plugin-section__caret">
                {isCollapsed ? "▸" : "▾"}
              </span>
              <span className="plugin-section__title">
                {t(SECTION_KEY[source])}
              </span>
              <span
                className="plugin-section__count"
                data-testid={SECTION_COUNT_TESTID[source]}
              >
                {group.length}
              </span>
            </button>
            {!isCollapsed &&
              group.map((r) => (
                <PluginRowView
                  key={r.manifest.id}
                  onDetails={() => onDetails(r)}
                  onReload={onReload ? () => onReload(r) : undefined}
                  onRemove={() => onRemove(r)}
                  onSettings={
                    onSettings && hasSettings?.(r.manifest.id)
                      ? () => onSettings(r)
                      : undefined
                  }
                  onToggle={() => onToggle(r)}
                  onUpdate={() => onUpdate(r)}
                  row={r}
                />
              ))}
          </section>
        );
      })}
    </>
  );
}
