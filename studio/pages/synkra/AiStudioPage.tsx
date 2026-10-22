import { Sparkles } from 'lucide-react'
import { ComingSoonPage } from './ComingSoonPage'

/** The AI Studio destination — a future product area, stubbed until the workspace ships. */
export default function AiStudioPage() {
  return (
    <ComingSoonPage
      section="ai"
      title="AI Studio"
      metaDescription="The Synkra Design AI Studio is in the works. It will open here when it ships."
      icon={<Sparkles size={30} />}
      tint="peach"
      description="A workspace for AI-assisted design tools is being prepared for Synkra Design. Nothing is available in this area yet — when it ships, it will open here."
      note="In the meantime, the Design Studio has everything you need to design, animate and export."
    />
  )
}
