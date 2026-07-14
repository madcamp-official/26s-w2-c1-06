import { useCallback, useEffect, useState } from 'react'
import type { Project } from '@shared/types'

interface UseProjectsResult {
  projects: Project[]
  loading: boolean
  refresh: () => Promise<void>
  selectFolder: () => Promise<string | null>
  createProject: (name: string, workspacePath: string) => Promise<Project>
}

// 프로젝트(코드베이스 단위 묶음) 목록 + 생성. 관제실/구조도/강의노트는 모두 여기서
// 고른 project_id로 스코프되므로, 앱은 이 목록에서 프로젝트를 고르는 것으로 시작한다.
export function useProjects(): UseProjectsResult {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async (): Promise<void> => {
    const rows = await window.factcoding.listProjects()
    setProjects(rows)
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const selectFolder = (): Promise<string | null> => window.factcoding.selectProjectFolder()

  const createProject = async (name: string, workspacePath: string): Promise<Project> => {
    const project = await window.factcoding.createProject(name, workspacePath)
    await refresh()
    return project
  }

  return { projects, loading, refresh, selectFolder, createProject }
}
