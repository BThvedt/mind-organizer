'use client';

import { useEffect, useState } from 'react';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface TaxonomyTerm {
  id: string;
  attributes: { name: string };
}

interface AreaSubjectSelectorProps {
  areaUuid: string;
  subjectUuid: string;
  onAreaChange: (uuid: string) => void;
  onSubjectChange: (uuid: string) => void;
  layout?: 'row' | 'col';
}

export function AreaSubjectSelector({
  areaUuid,
  subjectUuid,
  onAreaChange,
  onSubjectChange,
  layout = 'row',
}: AreaSubjectSelectorProps) {
  const [areas, setAreas] = useState<TaxonomyTerm[]>([]);
  const [subjects, setSubjects] = useState<TaxonomyTerm[]>([]);
  const [loadingAreas, setLoadingAreas] = useState(true);
  const [loadingSubjects, setLoadingSubjects] = useState(false);

  useEffect(() => {
    fetch('/api/taxonomy?type=areas')
      .then((r) => r.json())
      .then((d) => setAreas(d.data ?? []))
      .finally(() => setLoadingAreas(false));
  }, []);

  useEffect(() => {
    if (!areaUuid) {
      setSubjects([]);
      return;
    }
    setLoadingSubjects(true);
    fetch(`/api/taxonomy?type=subjects&area=${areaUuid}`)
      .then((r) => r.json())
      .then((d) => setSubjects(d.data ?? []))
      .finally(() => setLoadingSubjects(false));
  }, [areaUuid]);

  const handleAreaChange = (value: string) => {
    onAreaChange(value === '__none__' ? '' : value);
    onSubjectChange('');
  };

  const containerClass =
    layout === 'row'
      ? 'flex flex-col sm:flex-row gap-3'
      : 'flex flex-col gap-3';

  return (
    <div className={containerClass}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="area-select">Area</Label>
        <Select value={areaUuid || '__none__'} onValueChange={handleAreaChange}>
          <SelectTrigger id="area-select" className="w-full sm:w-48">
            <SelectValue placeholder={loadingAreas ? 'Loading…' : 'No area'} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">No area</SelectItem>
            {areas.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.attributes.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="subject-select">Subject</Label>
        <Select
          value={subjectUuid || '__none__'}
          onValueChange={(v) => onSubjectChange(v === '__none__' ? '' : v)}
          disabled={!areaUuid || loadingSubjects}
        >
          <SelectTrigger id="subject-select" className="w-full sm:w-48">
            <SelectValue
              placeholder={
                !areaUuid
                  ? 'Select an area first'
                  : loadingSubjects
                    ? 'Loading…'
                    : 'No subject'
              }
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">No subject</SelectItem>
            {subjects.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.attributes.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
