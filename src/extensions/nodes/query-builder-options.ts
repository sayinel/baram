// §5.13/§310 쿼리 빌더가 고르게 하는 것 — 소스마다 필드와 연산자가 다르다.
//
// 뷰에서 뽑아 둔 이유: 소스가 둘이 되면서 이 표가 "화면이 무엇을 보여 줄지"가 아니라
// **"어떤 질의가 뜻이 있는지"**를 정하는 자리가 됐다. 태스크 쪽 표는 실행기가 갖고
// (`task-query.ts`) 여기서는 그것을 그대로 쓴다 — 빌더가 고르게 한 조합을 실행기가
// 통과시키지 않으면 결과가 언제나 0인데 화면은 아무 말도 하지 않는다.
import type { QueryDef, QuerySource } from "../../utils/query-parser";

import {
  TASK_QUERY_FIELDS,
  TASK_QUERY_OPERATORS,
} from "../../utils/tasks/task-query";

const FILE_FIELDS = [
  "tags",
  "status",
  "path",
  "body",
  "updated_at",
  "created_at",
  "name",
];

const FILE_OPERATORS: Record<string, string[]> = {
  body: ["contains"],
  created_at: ["before", "after"],
  name: ["contains", "starts", "="],
  path: ["starts", "contains", "regex"],
  status: ["=", "!=", "contains", "empty"],
  tags: ["contains", "not_contains"],
  updated_at: ["before", "after"],
};

/** 이 소스에서 고를 수 있는 필드. */
export function fieldsFor(source: QuerySource): readonly string[] {
  return source === "tasks" ? TASK_QUERY_FIELDS : FILE_FIELDS;
}

/**
 * 이 소스·이 필드에서 뜻이 있는 연산자. 모르는 필드에는 파일 쪽의 무난한 셋을 준다 —
 * 손으로 적은 DSL이 낯선 필드를 들고 빌더에 들어오는 경우가 있다.
 */
export function operatorsFor(source: QuerySource, field: string): string[] {
  const table = source === "tasks" ? TASK_QUERY_OPERATORS : FILE_OPERATORS;
  return table[field] ?? ["=", "!=", "contains"];
}

/** 이 필터가 이 소스에서 말이 되는가 — 소스를 바꿀 때 남길지 버릴지의 판정. */
export function isFieldOfSource(source: QuerySource, field: string): boolean {
  return fieldsFor(source).includes(field);
}

/**
 * 소스를 바꾼 뒤의 질의 — 새 소스에서 뜻이 없는 필터와 정렬은 **버린다.**
 *
 * ‼️ 그대로 들고 있으면 결과가 언제나 0인데 화면은 아무 말도 하지 않는다. 사용자는
 * "이 소스에는 데이터가 없다"로 읽고, 실제로는 `tags`로 태스크를 거르고 있는 상태다.
 */
export function retargetQuery(def: QueryDef, source: QuerySource): QueryDef {
  return {
    ...def,
    filters: def.filters.filter((f) => isFieldOfSource(source, f.field)),
    sort: def.sort && isFieldOfSource(source, def.sort.field) ? def.sort : null,
    source,
  };
}
