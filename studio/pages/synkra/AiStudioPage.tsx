import AgentHomePage from '@/pages/synkra/agent/AgentHomePage'

/**
 * The `/ai-studio` destination now hosts the SYNKRA Agent Studio (powered by
 * OpenDesign). This file remains as the route's entry module so existing
 * imports and deep links keep working; the workspace lives in
 * `@/pages/synkra/agent`.
 */
export default function AiStudioPage() {
  return <AgentHomePage />
}
