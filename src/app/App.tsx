import { SiteScene } from '../render/scene/SiteScene';
import { DetailCard, ZoneCard } from '../ui/Cards';
import { ScanZoom } from '../ui/Barcode';
import { LeftPanel } from '../ui/LeftPanel';
import { RightPanel } from '../ui/RightPanel';
import { ScanBubbles } from '../ui/ScanBubbles';
import { TopBar } from '../ui/TopBar';
import { AppContext, type AppCtx } from './context';

export function App({ app }: { app: AppCtx }) {
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
