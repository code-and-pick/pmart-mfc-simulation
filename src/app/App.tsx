import { useEffect } from 'react';
import { SiteScene } from '../render/scene/SiteScene';
import { DetailCard, ZoneCard } from '../ui/Cards';
import { ScanZoom } from '../ui/Barcode';
import { LeftPanel } from '../ui/LeftPanel';
import { RightPanel } from '../ui/RightPanel';
import { ScanBubbles } from '../ui/ScanBubbles';
import { TopBar } from '../ui/TopBar';
import { AppContext, type AppCtx } from './context';

export function App({ app }: { app: AppCtx }) {
  // 주소 ?focus=<백엔드 위치 코드> — 열자마자 그 칸(또는 자리)으로 카메라(링크 공유·화면 확인용)
  useEffect(() => {
    const code = new URLSearchParams(location.search).get('focus');
    if (!code) return;
    const t = setTimeout(() => app.controller.focusBackendCode(code), 500);
    return () => clearTimeout(t);
  }, [app]);
  return (
    <AppContext.Provider value={app}>
      <div id="viewport">
        <SiteScene app={app} />
      </div>
      {app.sim.real && <ScanBubbles />}
      <div id="ui">
        <TopBar />
        <LeftPanel />
        <RightPanel />
        <ZoneCard />
        <DetailCard />
      </div>
      <ScanZoom />
    </AppContext.Provider>
  );
}
