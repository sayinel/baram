# Settings Redesign P1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Activity Bar customization and i18n (EN/KR) language support.

**Architecture:** Activity Bar config stored in settings-store as ordered array of {id, visible} entries. i18n uses a lightweight custom hook with JSON translation files — no external library needed for 2 languages.

**Tech Stack:** React, TypeScript, Zustand, CSS

---

## Task 1: Activity Bar Customization — Store + Settings Tab

Add `activityBarConfig` to settings-store and create an ActivityBar settings tab with drag-to-reorder and show/hide toggles.

## Task 2: Activity Bar — Apply Config to ActivityBar Component

Update `ActivityBar.tsx` to read config from settings-store and render icons accordingly.

## Task 3: i18n Framework — Translation Files + Hook

Create `src/i18n/` with `en.json`, `ko.json`, a `useTranslation` hook, and `locale` in settings-store.

## Task 4: i18n — Apply to Settings Modal + Language Tab

Translate SettingsModal labels and add a Language settings tab.

## Task 5: Build Verification
