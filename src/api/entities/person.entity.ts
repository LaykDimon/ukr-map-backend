import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  BeforeInsert,
  BeforeUpdate,
} from 'typeorm';

export interface PersonMetaData {
  occupation?: string[];
  placeOfBirth?: string;
  deathPlace?: string;
  deathYear?: number;
  wikiLink?: string;
  alternativeNames?: string[];
}

@Entity()
export class Person {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  name: string;

  @Index({ unique: true })
  @Column({ nullable: true })
  slug: string;

  @Column({ nullable: true })
  wikiPageId: number;

  @Column({ type: 'text', nullable: true })
  summary: string;

  @Index()
  @Column({ nullable: true })
  birthYear: number;

  @Column({ nullable: true })
  birthDate: string;

  @Index()
  @Column({ nullable: true })
  birthPlace: string;

  @Index()
  @Column({ type: 'float', nullable: true })
  lat: number;

  @Index()
  @Column({ type: 'float', nullable: true })
  lng: number;

  @Index('idx_person_meta_data_gin', { synchronize: false })
  @Column({ type: 'jsonb', default: {} })
  meta_data: PersonMetaData;

  @Column({ default: 0 })
  views: number;

  @Index()
  @Column({ type: 'float', default: 0 })
  rating: number;

  @Column({ nullable: true })
  imageUrl: string;

  @Index()
  @Column({ nullable: true })
  category: string;

  // PostGIS geometry column — requires PostGIS extension.
  // Install PostGIS first, then enable: CREATE EXTENSION IF NOT EXISTS postgis;
  @Index('idx_person_birth_location_gist', { spatial: true })
  @Column({
    type: 'geometry',
    spatialFeatureType: 'Point',
    srid: 4326,
    nullable: true,
    select: false,
  })
  birthLocation: string;

  @Column({ default: false })
  isManual: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @BeforeInsert()
  @BeforeUpdate()
  generateSlug() {
    if (this.name && !this.slug) {
      this.slug = this.name
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim();
    }
  }
}
