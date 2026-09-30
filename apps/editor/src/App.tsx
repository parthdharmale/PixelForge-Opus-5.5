import { useEffect } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { api } from './lib/api';
import { useEditor } from './state/store';
import { Launcher } from './components/Launcher';
import { TopBar } from './components/TopBar';
import { Canvas } from './components/Canvas';
import { LeftPanel } from './components/LeftPanel';
import { Inspector } from './components/Inspector';
import { BottomPanel } from './components/BottomPanel';
import { Toasts, ShortcutsDialog } from './components/Misc';

export default function App() {
  const session = useEditor((s) => s.session);
  useEffect(() => {
    api
      .health()
      .then((h) => useEditor.getState().set((s) => ({ ai: { ...s.ai, providers: h.ai.providers, provider: h.ai.default } })))
      .catch(() => useEditor.getState().toast('error', 'Cannot reach the PixelForge server on port 4000.'));
  }, []);

  return (
    <div className="app">
      {session ? (
        <>
          <TopBar />
          <PanelGroup direction="horizontal" autoSaveId="pf-main" style={{ flex: 1, minHeight: 0 }}>
            <Panel defaultSize={18} minSize={12} maxSize={35}>
              <LeftPanel />
            </Panel>
            <PanelResizeHandle className="resize-handle" />
            <Panel minSize={30}>
              <PanelGroup direction="vertical" autoSaveId="pf-center">
                <Panel minSize={30}>
                  <Canvas />
                </Panel>
                <PanelResizeHandle className="resize-handle" />
                <Panel defaultSize={30} minSize={8} collapsible>
                  <BottomPanel />
                </Panel>
              </PanelGroup>
            </Panel>
            <PanelResizeHandle className="resize-handle" />
            <Panel defaultSize={23} minSize={16} maxSize={40}>
              <Inspector />
            </Panel>
          </PanelGroup>
        </>
      ) : (
        <Launcher />
      )}
      <Toasts />
      <ShortcutsDialog />
    </div>
  );
}
