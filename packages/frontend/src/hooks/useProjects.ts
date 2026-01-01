import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

export type ProjectOption = {
  id: string;
  code: string;
  name: string;
};

type UseProjectsOptions = {
  selectedProjectId: string;
  onSelect: (projectId: string) => void;
};

export const useProjects = ({
  selectedProjectId,
  onSelect,
}: UseProjectsOptions) => {
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectMessage, setProjectMessage] = useState('');

  const loadProjects = useCallback(async () => {
    try {
      const res = await api<{ items: ProjectOption[] }>('/projects');
      setProjects(res.items || []);
      setProjectMessage('');
    } catch (err) {
      console.error('Failed to load projects.', err);
      setProjects([]);
      setProjectMessage('案件一覧の取得に失敗しました');
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (projects.length === 0) return;
    if (projects.some((project) => project.id === selectedProjectId)) {
      return;
    }
    onSelect(projects[0].id);
  }, [projects, selectedProjectId, onSelect]);

  return { projects, projectMessage, loadProjects };
};
