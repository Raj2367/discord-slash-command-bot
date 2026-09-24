-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "InteractionStatus" AS ENUM ('RECEIVED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ActionType" AS ENUM ('DISCORD_RESPONSE', 'CHANNEL_POST', 'MIRROR');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "Admin" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscordServerConfig" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "guildName" TEXT NOT NULL,
    "channelId" TEXT,
    "mirrorType" TEXT,
    "mirrorWebhookUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscordServerConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommandRule" (
    "id" TEXT NOT NULL,
    "commandName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "responseText" TEXT NOT NULL,
    "mirrorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "channelPostEnabled" BOOLEAN NOT NULL DEFAULT false,
    "aiEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommandRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InteractionLog" (
    "id" TEXT NOT NULL,
    "interactionId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "commandName" TEXT NOT NULL,
    "commandOptions" JSONB,
    "status" "InteractionStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "InteractionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionRecord" (
    "id" TEXT NOT NULL,
    "interactionLogId" TEXT NOT NULL,
    "type" "ActionType" NOT NULL,
    "status" "ActionStatus" NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Admin_email_key" ON "Admin"("email");

-- CreateIndex
CREATE UNIQUE INDEX "DiscordServerConfig_guildId_key" ON "DiscordServerConfig"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "CommandRule_commandName_key" ON "CommandRule"("commandName");

-- CreateIndex
CREATE UNIQUE INDEX "InteractionLog_interactionId_key" ON "InteractionLog"("interactionId");

-- CreateIndex
CREATE INDEX "InteractionLog_createdAt_idx" ON "InteractionLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ActionRecord_interactionLogId_type_key" ON "ActionRecord"("interactionLogId", "type");

-- AddForeignKey
ALTER TABLE "ActionRecord" ADD CONSTRAINT "ActionRecord_interactionLogId_fkey" FOREIGN KEY ("interactionLogId") REFERENCES "InteractionLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
