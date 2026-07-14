import { useState } from 'react'
import { Code2, FolderOpen, FolderPlus, Loader2 } from 'lucide-react'
import type { Project } from '@shared/types'
import { formatTime } from '@shared/format'

interface ProjectsViewProps {
  projects: Project[]
  loading: boolean
  currentProjectId: string | null
  onSelect: (projectId: string) => void
  onSelectFolder: () => Promise<string | null>
  onCreate: (name: string, workspacePath: string) => Promise<Project>
}

// 프로젝트 탭: 관제실/구조도/강의노트가 project_id로 스코프되므로, 앱을 켜면 항상 여기서
// 시작해 기존 프로젝트를 고르거나 이름+코드 워크스페이스를 등록해 새 프로젝트를 만든다.
export function ProjectsView({
  projects,
  loading,
  currentProjectId,
  onSelect,
  onSelectFolder,
  onCreate
}: ProjectsViewProps) {
  const [name, setName] = useState('')
  const [workspacePath, setWorkspacePath] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const pickFolder = async (): Promise<void> => {
    const path = await onSelectFolder()
    if (path) setWorkspacePath(path)
  }

  const submit = async (): Promise<void> => {
    if (!name.trim() || !workspacePath || creating) return
    setCreating(true)
    try {
      const project = await onCreate(name.trim(), workspacePath)
      setName('')
      setWorkspacePath(null)
      onSelect(project.id)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,1fr)]">
      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-[0_3px_14px_rgba(42,46,38,.06)]">
        <div className="border-b border-border px-5 py-3.5">
          <h3 className="text-[13px] font-semibold">내 프로젝트</h3>
          <p className="font-mono text-[10px] text-[#6d7069]">
            {String(projects.length).padStart(2, '0')} REGISTERED · 클릭해서 시작하기
          </p>
        </div>

        {loading ? (
          <p className="px-5 py-10 text-center text-[13px] text-muted-foreground">불러오는 중…</p>
        ) : projects.length === 0 ? (
          <div className="grid place-items-center px-6 py-14 text-center">
            <Code2 size={28} className="mb-3 text-[#9a9a92]" />
            <p className="max-w-[360px] text-[13px] leading-6 text-muted-foreground">
              아직 등록된 프로젝트가 없습니다. 오른쪽에서 이름과 코드 워크스페이스를 등록해
              첫 프로젝트를 시작하세요.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            {projects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => onSelect(project.id)}
                className={`flex items-start gap-3 rounded-lg border p-4 text-left transition ${
                  project.id === currentProjectId
                    ? 'border-[#b8d9ce] bg-[#eaf4ef]'
                    : 'border-border bg-[#f6f5f1] hover:border-[#b8d9ce] hover:bg-[#eaf4ef]'
                }`}
              >
                <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#eef2f6] text-[#3f6b86]">
                  <Code2 size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold text-[#21221f]">
                    {project.name}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[10.5px] text-[#6d7069]">
                    {project.workspace_path}
                  </span>
                  {project.created_at && (
                    <span className="mt-1.5 block font-mono text-[10px] text-[#9a9a92]">
                      {formatTime(project.created_at)} 등록
                    </span>
                  )}
                </div>
                {project.id === currentProjectId && (
                  <span className="shrink-0 rounded bg-[#e4f0eb] px-1.5 py-0.5 font-mono text-[9px] font-medium text-[#245248]">
                    현재
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="h-fit rounded-xl border border-[#b8d9ce] bg-[#eef7f2] p-5 shadow-[0_3px_14px_rgba(42,46,38,.06)]">
        <div className="mb-4 flex items-center gap-2">
          <FolderPlus size={16} className="text-[#285c52]" />
          <span className="font-mono text-[10px] font-medium tracking-[0.12em] text-[#3c7566]">
            새 프로젝트
          </span>
        </div>

        <label className="mb-1.5 block text-[12px] font-medium text-[#1f4a41]">이름</label>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="예: campus-market"
          className="mb-4 w-full rounded-lg border border-[#cfe3d8] bg-[#f6f5f1] px-3 py-2 text-[13px] text-foreground placeholder:text-[#9a9a92] focus:outline-none focus:ring-1 focus:ring-ring/60"
        />

        <label className="mb-1.5 block text-[12px] font-medium text-[#1f4a41]">
          코드 워크스페이스
        </label>
        <button
          type="button"
          onClick={pickFolder}
          className="mb-1.5 flex w-full items-center gap-2 rounded-lg border border-dashed border-[#cfe3d8] bg-[#f6f5f1] px-3 py-2.5 text-left text-[12.5px] text-[#3c7566] transition hover:border-[#4f9c84] hover:bg-[#eef6f1]"
        >
          <FolderOpen size={15} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate font-mono">
            {workspacePath ?? '폴더 선택…'}
          </span>
        </button>
        <p className="mb-4 text-[11px] leading-5 text-[#5c7a6d]">
          이 폴더의 Claude Code 세션을 관찰해 관제실·구조도·강의노트를 만듭니다.
        </p>

        <button
          type="button"
          onClick={submit}
          disabled={!name.trim() || !workspacePath || creating}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#285c52] py-2.5 text-[12px] font-semibold text-[#ffffff] transition hover:bg-[#1f4a41] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {creating ? <Loader2 size={15} className="animate-spin" /> : <FolderPlus size={15} />}
          {creating ? '만드는 중…' : '프로젝트 만들고 시작하기'}
        </button>
      </section>
    </div>
  )
}
