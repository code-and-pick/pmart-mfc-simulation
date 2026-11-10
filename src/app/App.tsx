import { SiteScene } from '../render/scene/SiteScene';
import { DetailCard, ZoneCard } from '../ui/Cards';
import { LeftPanel } from '../ui/LeftPanel';
import { RightPanel } from '../ui/RightPanel';
import { TopBar } from '../ui/TopBar';
import { AppContext, type AppCtx } from './context';

export function App({ app }: { app: AppCtx }) {
  return (
    <AppContext.Provider value={app}>
      <div id="viewport">
        <SiteScene app={app} />
      </div>
      <div id="ui">
        <TopBar />
        <LeftPanel />
        <RightPanel />
        <ZoneCard />
        <DetailCard />
      </div>
    </AppContext.Provider>
  );
}
