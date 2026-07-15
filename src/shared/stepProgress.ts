// 실시간 진행 로그(step-worker.ts) 전용 타입. Main → Renderer "지금 하는 중" 한 줄
// 상태(IPC step:live-status)에 쓰인다. 스텝별 요약/핵심 코드 자체는 ai_explanations
// (target_type='step')에 저장되고 기존 db:getExplanations류 IPC로 조회하므로,
// 여기엔 DB에 남기지 않는 휘발성 상태만 둔다.
export interface LiveStatus {
  text: string
  idle: boolean
  // 지금 관찰 중인 세션에서 훅 마커를 관찰했는지(sessions.hooks_alive) — 훅 세션은
  // 턴 완료가 Stop 훅(completed_at)으로 즉시 오므로, 렌더러는 idle을 완료 판정
  // 폴백으로 쓰지 않아야 한다(긴 thinking 구간을 완료로 오판해 진행바가 100%로
  // 튀었다 되돌아오는 플리커의 원인이 된다).
  hooksAlive: boolean
  // 이 상태가 어느 턴(prompt)에 대한 것인지 식별하기 위한 ID
  turnId?: string | null
}
