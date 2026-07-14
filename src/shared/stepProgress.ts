// 실시간 진행 로그(step-worker.ts) 전용 타입. Main → Renderer "지금 하는 중" 한 줄
// 상태(IPC step:live-status)에 쓰인다. 스텝별 요약/핵심 코드 자체는 ai_explanations
// (target_type='step')에 저장되고 기존 db:getExplanations류 IPC로 조회하므로,
// 여기엔 DB에 남기지 않는 휘발성 상태만 둔다.
export interface LiveStatus {
  text: string
  idle: boolean
}
