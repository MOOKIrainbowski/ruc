/**
 * RPG 베타 게임 서버가 열렸는가. 게임 서버는 Vercel 밖에서 따로 돌아서(RUC_RPG/docs/PLAN.md "운영 배포"),
 * 운영에서는 Vercel 환경변수에 게임 서버 주소와 입장 티켓 비밀값이 둘 다 있어야 입장을 엽니다. next dev 는 항상 열림.
 */
export const rpgOpen = () =>
  process.env.NODE_ENV === "development" || (!!process.env.NEXT_PUBLIC_RPG_WS_URL?.trim() && !!process.env.RPG_TICKET_SECRET?.trim());
