import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { ChangeType, UnitType } from '@shared/types'

export interface PlayerUnitNodeData {
  name: string
  unitType: UnitType
  versionCount: number
  latestChangeType: ChangeType | null
  selected: boolean
  recent: boolean
  [key: string]: unknown
}

const CHANGE_SHORT: Record<string, string> = {
  created: 'NEW',
  modified: 'MOD',
  deleted: 'OUT'
}

function PlayerUnitNodeComponent({ data }: NodeProps) {
  const d = data as PlayerUnitNodeData

  return (
    <div
      className={`player-card ${d.selected ? 'player-card--selected' : ''} ${
        d.recent ? 'player-card--recent' : ''
      }`}
    >
      <Handle type="target" position={Position.Left} className="player-card__handle" />
      <div className="player-card__type">{d.unitType}</div>
      <div className="player-card__name">{d.name}</div>
      <div className="player-card__stats">
        <span>v{d.versionCount}</span>
        {d.latestChangeType && (
          <span className={`player-card__change player-card__change--${d.latestChangeType}`}>
            {CHANGE_SHORT[d.latestChangeType] ?? d.latestChangeType}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="player-card__handle" />
    </div>
  )
}

export const PlayerUnitNode = memo(PlayerUnitNodeComponent)
