import { useEffect, useSyncExternalStore } from 'react';
import { SiteScene } from '../render/scene/SiteScene';
import { DetailCard } from '../ui/Cards';
import { ScanZoom } from '../ui/Barcode';
import { LeftPanel } from '../ui/LeftPanel';
import { IssueBar } from '../ui/IssueBar';
import { Rail } from '../ui/Rail';
import { RightPanel } from '../ui/RightPanel';
import { ScanBubbles } from '../ui/ScanBubbles';
import { DcArrivals } from '../ui/DcArrivals';
import { TopBar, ViewBar } from '../ui/TopBar';
import { AppContext, type AppCtx } from './context';

export function App({ app }: { app: AppCtx }) {
  // 주소 ?focus=<백엔드 위치 코드> — 열자마자 그 칸(또는 자리)으로 카메라(링크 공유·화면 확인용)
  useEffect(() => {
    const code = new URLSearchParams(location.search).get('focus');
    if (!code) return;
    const t = setTimeout(() => app.controller.focusBackendCode(code), 500);
    return () => clearTimeout(t);
  }, [app]);
  // 테마·패널 접힘은 ViewController — 뼈대 data-* 로 CSS 가 색·카드 자리를 맞춘다
  const view = app.controller;
  useSyncExternalStore(view.subscribe, view.getVersion);
  useEffect(() => {
    document.documentElement.dataset.theme = view.theme;
  }, [view.theme]);
  return (
    <AppContext.Provider value={app}>
      <div id="viewport">
        <SiteScene app={app} />
      </div>
      {app.sim.board && <ScanBubbles />}
      {app.sim.real && <DcArrivals />}
      {/* 뼈대(pmart-rider-simulation 참고): [왼쪽 아이콘 메뉴 | 머리줄 → 확인할 일 → [왼쪽 패널 · 3D · 오른쪽 패널]] */}
      <div id="ui" data-left={view.leftView ? 'open' : 'closed'} data-right={view.rightView ? 'open' : 'closed'}>
        <Rail />
        <div className="shell">
          <TopBar />
          <IssueBar />
          <div className="stage">
            <LeftPanel />
            <div className="stage-gap">
              <ViewBar />
            </div>
            <RightPanel />
          </div>
        </div>
        <DetailCard />
      </div>
      <ScanZoom />
    </AppContext.Provider>
  );
}
