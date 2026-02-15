import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Person } from './person.entity';
import { User } from './user.entity';

export enum ProposedEditStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

@Entity()
export class ProposedEdit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  personId: string;

  @ManyToOne(() => Person, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'personId' })
  person: Person;

  @Column()
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'jsonb' })
  changes: Record<string, { old: any; new: any }>;

  @Column({ nullable: true })
  comment: string;

  @Column({
    type: 'enum',
    enum: ProposedEditStatus,
    default: ProposedEditStatus.PENDING,
  })
  status: ProposedEditStatus;

  @Column({ nullable: true })
  reviewedBy: number;

  @Column({ nullable: true })
  reviewComment: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
