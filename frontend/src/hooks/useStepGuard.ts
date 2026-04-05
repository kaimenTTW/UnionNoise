import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUnlockedUpTo } from '../store/projectStore'

/**
 * Redirect to the last unlocked step if the user tries to access a locked step.
 * Call at the top of each step component.
 */
export function useStepGuard(currentStep: number): void {
  const unlockedUpTo = useUnlockedUpTo()
  const navigate = useNavigate()

  useEffect(() => {
    if (currentStep > unlockedUpTo) {
      navigate(`/step/${unlockedUpTo}`, { replace: true })
    }
  }, [currentStep, unlockedUpTo, navigate])
}
