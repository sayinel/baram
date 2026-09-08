/// <reference types="astro/client" />

// ‼️ Starlight 은 `virtual:starlight/user-config` 의 **타입을 내보내지 않는다** — 그 모듈을
//    읽는 것이 패키지 안의 .js 뿐이라 선언이 없고, 오버라이드 컴포넌트에서 import 하면
//    `astro check` 가 ts(2307) 로 막는다(빌드는 통과하므로 `npm run build` 만으로는 안 걸린다).
//    모듈이 내주는 것은 해석된 설정 그 자체이므로 공개 타입 `StarlightConfig` 를 그대로 붙인다 —
//    임의 모양을 적으면 그만큼 검사가 헐거워진다.
declare module "virtual:starlight/user-config" {
  const config: import("@astrojs/starlight/types").StarlightConfig;
  export default config;
}
