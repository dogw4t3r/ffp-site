import { createFileRoute } from '@tanstack/react-router'

import EngineChessApp from "@/components/EngineChessApp.tsx";

export const Route = createFileRoute('/')({ component: App })

function App() {
  return (
    <EngineChessApp />
  )
}
