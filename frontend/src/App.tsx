import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Step1 from './steps/Step1'
import Step2 from './steps/Step2'
import Step3 from './steps/Step3'
import Step4 from './steps/Step4'
import Step5 from './steps/Step5'
import Step6 from './steps/Step6'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1 },
    mutations: { retry: 0 },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/step/1" replace />} />
          <Route path="step/1" element={<Step1 />} />
          <Route path="step/2" element={<Step2 />} />
          <Route path="step/3" element={<Step3 />} />
          <Route path="step/4" element={<Step4 />} />
          <Route path="step/5" element={<Step5 />} />
          <Route path="step/6" element={<Step6 />} />
          <Route path="*" element={<Navigate to="/step/1" replace />} />
        </Route>
      </Routes>
    </QueryClientProvider>
  )
}
