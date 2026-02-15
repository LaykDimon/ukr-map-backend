import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export enum ImportStatus {
  SUCCESS = 'success',
  FAILED = 'failed',
}

@Entity()
export class ImportLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  sourceUrl: string;

  @Column({
    type: 'enum',
    enum: ImportStatus,
  })
  status: ImportStatus;

  @Column({ type: 'text', nullable: true })
  message: string;

  @Column({ default: 0 })
  recordsProcessed: number;

  @CreateDateColumn()
  importedAt: Date;
}
