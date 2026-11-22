import { createContext, useContext, useSyncExternalStore } from 'react';
import type { SceneRegistry, Ticker, ViewController } from '../render/controller';
import type { HttpSettings, Simulation } from '../sim/simulation';

export interface PersistedSettings {
  mode: 'mock' | 'http';
  http: HttpSettings;
  /** 지점(MFC_SITES id) — 없으면 1호점 */
  mfcId?: string;
}

export interface AppCtx {
  sim: Simulation;
  controller: ViewController;
  registry: SceneRegistry;
  ticker: Ticker;
  settings: PersistedSettings;
  restart: (s: PersistedSettings) => void;
}

export const AppContext = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('AppContext 밖에서 useApp 을 불렀다');
  return ctx;
}

/** 선택·구역·벽·번호 표시가 바뀌면 다시 그린다. */
export function useView(): ViewController {
  const { controller } = useApp();
  useSyncExternalStore(controller.subscribe, controller.getVersion);
  return controller;
}

/** 시뮬레이션 화면 박자(약 4Hz)마다 다시 그린다. */
export function useTick(): number {
  const { ticker } = useApp();
  return useSyncExternalStore(ticker.subscribe, ticker.getVersion);
}
