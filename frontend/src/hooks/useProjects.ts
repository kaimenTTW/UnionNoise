import type { Project } from '../types'

/**
 * Returns the list of projects for the Overview page.
 *
 * Upgrade path: replace the MOCK_PROJECTS return with a React Query call to
 * GET /api/projects when backend persistence is ready. The hook signature
 * stays the same — callers don't need to change.
 *
 * Example future implementation:
 *   return useQuery({ queryKey: ['projects'], queryFn: () => api.get('/api/projects') })
 */

const MOCK_PROJECTS: Project[] = [
  {
    id: 'cr208',
    project_name: 'CR208 Noise Barrier',
    barrier_type: 'Type 1',
    location: 'Clementi Ave 3, Singapore',
    created_at: '2026-03-15',
    status: 'complete',
  },
  {
    id: 'bayshore-c2',
    project_name: 'Bayshore C2 Perimeter Barrier',
    barrier_type: 'Type 1',
    location: 'Bayshore Road, Singapore',
    created_at: '2026-03-28',
    status: 'draft',
  },
  {
    id: 'p105-punggol',
    project_name: 'P105 Punggol Waterway',
    barrier_type: 'Type 2',
    location: 'Punggol Field, Singapore',
    created_at: '2026-04-01',
    status: 'draft',
  },
]

export function useProjects(): Project[] {
  // TODO: replace with React Query call to GET /api/projects
  return MOCK_PROJECTS
}
