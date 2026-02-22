// §4.9 Welcome Screen — 첫 실행 시 에디터 영역에 표시
import { useState } from "react";
import { useUIStore } from "../../stores/ui-store";

interface WelcomeScreenProps {
  onNewFile: () => void;
  onOpenFile: () => void;
  onOpenFolder: () => void;
}

export function WelcomeScreen({ onNewFile, onOpenFile, onOpenFolder }: WelcomeScreenProps) {
  const { dismissWelcome } = useUIStore();
  const [dontShowAgain, setDontShowAgain] = useState(false);

  const handleNewFile = () => {
    dismissWelcome(dontShowAgain);
    onNewFile();
  };

  const handleOpenFile = () => {
    dismissWelcome(dontShowAgain);
    onOpenFile();
  };

  const handleOpenFolder = () => {
    dismissWelcome(dontShowAgain);
    onOpenFolder();
  };

  return (
    <div className="welcome-screen">
      <div className="welcome-card">
        <h1 className="welcome-title">Baram에 오신 것을 환영합니다</h1>
        <p className="welcome-tagline">
          가볍고, 아름답고, 연결되는 마크다운 에디터
        </p>

        <div className="welcome-actions">
          <button className="welcome-btn welcome-btn-primary" onClick={handleOpenFolder}>
            폴더 열기
          </button>
          <button className="welcome-btn welcome-btn-secondary" onClick={handleOpenFile}>
            파일 열기
          </button>
          <button className="welcome-btn welcome-btn-secondary" onClick={handleNewFile}>
            새 파일
          </button>
        </div>

        <div className="welcome-tips">
          <p className="welcome-tips-title">빠른 시작</p>
          <ul className="welcome-tips-list">
            <li>
              <kbd>⌘</kbd> + <kbd>P</kbd> 커맨드 팔레트 열기
            </li>
            <li>
              <kbd>/</kbd> 슬래시 커맨드로 블록 추가
            </li>
            <li>
              <kbd>⌘</kbd> + <kbd>/</kbd> 소스 모드 전환
            </li>
          </ul>
        </div>

        <label className="welcome-footer">
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(e) => setDontShowAgain(e.target.checked)}
          />
          <span>다시 보지 않기</span>
        </label>
      </div>
    </div>
  );
}
