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

  const loadTasks = useCallback(async () => {
    if (!projectId) {
      setTasks([]);
      setTaskMessage('');
      return;
    }
    try {
      const res = await api<{ items: ProjectTaskOption[] }>(
        `/projects/${projectId}/tasks`,
      );
      setTasks(res.items || []);
      setTaskMessage('');
    } catch (err) {
      console.error('Failed to load tasks.', err);
      setTasks([]);
      setTaskMessage('タスク一覧の取得に失敗しました');
    }
  }, [projectId]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  return { tasks, taskMessage, loadTasks };
};
