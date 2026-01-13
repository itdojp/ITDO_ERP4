import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

export type ProjectTaskOption = {
  id: string;
  name: string;
};

type UseProjectTasksOptions = {
  projectId?: string;
};

export const useProjectTasks = ({ projectId }: UseProjectTasksOptions) => {
  const [tasks, setTasks] = useState<ProjectTaskOption[]>([]);
  const [taskMessage, setTaskMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const loadTasks = useCallback(async () => {
    if (!projectId) {
      setTasks([]);
      setTaskMessage('');
      setIsLoading(false);
      return;
    }
    try {
      setIsLoading(true);
      const res = await api<{ items: ProjectTaskOption[] }>(
        `/projects/${projectId}/tasks`,
      );
      setTasks(res.items || []);
      setTaskMessage('');
    } catch (err) {
      console.error('Failed to load tasks.', err);
      setTasks([]);
      setTaskMessage('タスク一覧の取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    if (!projectId) return;
    if (typeof window === 'undefined') return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: unknown }>).detail;
      if (!detail || typeof detail !== 'object') return;
      if (detail.projectId !== projectId) return;
      loadTasks();
    };
    window.addEventListener('erp4:project-tasks-changed', handler);
    return () =>
      window.removeEventListener('erp4:project-tasks-changed', handler);
  }, [loadTasks, projectId]);

  return { tasks, taskMessage, isLoading, loadTasks };
};
