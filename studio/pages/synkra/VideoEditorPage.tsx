import { Clapperboard } from 'lucide-react'
import { ComingSoonPage } from './ComingSoonPage'

/** The Video Editor destination — a future product area, stubbed until the workspace ships. */
export default function VideoEditorPage() {
  return (
    <ComingSoonPage
      section="video"
      title="Video Editor"
      metaDescription="The Synkra Design Video Editor is in the works. It will open here when it ships."
      icon={<Clapperboard size={30} />}
      tint="sky"
      description="A dedicated video editing workspace for Synkra Design is being built right now. Nothing is available in this area yet — when it ships, it will open here."
      note="Until then, the Design Studio can animate designs and export MP4, WebM and GIF files."
    />
  )
}
