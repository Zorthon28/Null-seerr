import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLiked1727000000000 implements MigrationInterface {
  name = 'AddLiked1727000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "liked" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "mediaType" varchar NOT NULL,
        "title" varchar NOT NULL DEFAULT '',
        "tmdbId" integer NOT NULL,
        "userId" integer NOT NULL,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now')),
        "mediaId" integer,
        CONSTRAINT "UNIQUE_USER_LIKED" UNIQUE ("tmdbId", "mediaType", "userId"),
        CONSTRAINT "FK_liked_user" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_liked_media" FOREIGN KEY ("mediaId") REFERENCES "media" ("id") ON DELETE CASCADE
      )`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_liked_tmdbId" ON "liked" ("tmdbId")`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_liked_userId" ON "liked" ("userId")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_liked_userId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_liked_tmdbId"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "liked"`);
  }
}
