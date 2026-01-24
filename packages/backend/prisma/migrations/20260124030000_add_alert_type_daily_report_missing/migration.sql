-- Add daily_report_missing to AlertType enum
ALTER TYPE "AlertType" ADD VALUE IF NOT EXISTS 'daily_report_missing';
