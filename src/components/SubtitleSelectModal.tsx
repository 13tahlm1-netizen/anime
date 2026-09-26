"use client";

import { useState, useRef, useEffect, DragEvent, ChangeEvent } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Search,
  Users,
  Upload,
  FileText,
  Wand2,
  ExternalLink,
  Check,
  Loader2,
  AlertCircle,
  Sparkles,
  Subtitles,
} from "lucide-react";

export interface CreatorInfo {
  name: string;
  episode: string;
  update_date: string;
  website: string;
  is_current_ep: boolean;
}

export interface SubtitleOption {
  name: string;
  format: "ASS" | "VTT";
  is_ass: boolean;
  content: string;
  url?: string;
}

interface SubtitleSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  animeId: string;
  animeTitle: string;
  episodeNumber: number;
  creators: CreatorInfo[];
  currentSubName?: string;
  onSelectSubtitle: (sub: SubtitleOption) => void;
}

export default function SubtitleSelectModal({
  isOpen,
  onClose,
  animeId,
  animeTitle,
  episodeNumber,
  creators,
  currentSubName,
  onSelectSubtitle,
}: SubtitleSelectModalProps) {
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<"creators" | "search" | "file">("creators");

  // Search tab states
  const [searchKeyword, setSearchKeyword] = useState(animeTitle || "");
  const [searchEp, setSearchEp] = useState(episodeNumber || 1);
  const [searchResults, setSearchResults] = useState<SubtitleOption[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Creator download states
  const [loadingCreator, setLoadingCreator] = useState<string | null>(null);
  const [creatorError, setCreatorError] = useState<string | null>(null);

  // File upload states
  const [uploadedSub, setUploadedSub] = useState<SubtitleOption | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen) {
      setSearchKeyword(animeTitle || "");
      setSearchEp(episodeNumber || 1);
      setCreatorError(null);
      setSearchError(null);
      setFileError(null);
    }
  }, [isOpen, animeTitle, episodeNumber]);

  if (!mounted || !isOpen) return null;

  // 1. Download and apply creator's subtitle
  const handleSelectCreator = async (creator: CreatorInfo) => {
    if (!creator.website || loadingCreator) return;
    setLoadingCreator(creator.name);
    setCreatorError(null);

    try {
      const res = await fetch("/api/anime/subtitles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creatorName: creator.name,
          website: creator.website,
          title: searchKeyword || animeTitle,
          episodeNumber: episodeNumber,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success || !data.subtitle) {
        throw new Error(data.message || "해당 제작자의 이번 회차 자막을 가져오지 못했습니다.");
      }

      const newSub: SubtitleOption = {
        name: `(${creator.name}) ${data.subtitle.orig_filename || `${episodeNumber}화 자막`}`,
        format: data.subtitle.is_ass ? "ASS" : "VTT",
        is_ass: Boolean(data.subtitle.is_ass),
        content: data.subtitle.content,
        url: data.subtitle.url,
      };

      onSelectSubtitle(newSub);
      onClose();
    } catch (err: any) {
      setCreatorError(err.message || "자막 다운로드에 실패했습니다.");
    } finally {
      setLoadingCreator(null);
    }
  };

  // 2. Perform manual search with user-entered keyword
  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const keyword = searchKeyword.trim();
    if (!keyword) return;

    setIsSearching(true);
    setSearchError(null);
    setSearchResults([]);

    try {
      const res = await fetch(
        `/api/anime/subtitles?title=${encodeURIComponent(keyword)}&ep=${searchEp}`
      );
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || "자막 검색 실패");
      }

      const subs: SubtitleOption[] = (data.subtitles || []).map((s: any) => ({
        name: s.name,
        format: s.is_ass ? "ASS" : "VTT",
        is_ass: Boolean(s.is_ass),
        content: s.content || "",
        url: s.url || "",
      }));

      setSearchResults(subs);
      if (subs.length === 0) {
        setSearchError("검색된 자막이 없습니다. 다른 제목(예: 한국어 정식 방영명)으로 검색해 보세요.");
      }
    } catch (err: any) {
      setSearchError(err.message || "자막을 검색하는 중 오류가 발생했습니다.");
    } finally {
      setIsSearching(false);
    }
  };

  // 3. Process local subtitle file (.ass, .srt, .smi, .vtt)
  const processSubtitleFile = (file: File) => {
    setFileError(null);
    const fileName = file.name;
    const lowerName = fileName.toLowerCase();

    if (
      !lowerName.endsWith(".ass") &&
      !lowerName.endsWith(".ssa") &&
      !lowerName.endsWith(".srt") &&
      !lowerName.endsWith(".smi") &&
      !lowerName.endsWith(".vtt")
    ) {
      setFileError("지원되는 자막 형식(.ass, .ssa, .srt, .smi, .vtt)이 아닙니다.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = (e.target?.result as string) || "";
      if (!text.trim()) {
        setFileError("자막 파일 내용이 비어 있습니다.");
        return;
      }

      const isAss = lowerName.endsWith(".ass") || lowerName.endsWith(".ssa");
      const newSub: SubtitleOption = {
        name: `[로컬 파일] ${fileName}`,
        format: isAss ? "ASS" : "VTT",
        is_ass: isAss,
        content: text,
      };

      setUploadedSub(newSub);
    };

    reader.onerror = () => {
      setFileError("파일을 읽는 도중 오류가 발생했습니다.");
    };

    // Korean SMI/SRT are often CP949 or UTF-8
    reader.readAsText(file, "UTF-8");
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processSubtitleFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processSubtitleFile(e.target.files[0]);
    }
  };

  const modalContent = (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-md transition-opacity"
        onClick={onClose}
      />

      {/* Modal Dialog */}
      <div className="relative w-full max-w-2xl overflow-hidden rounded-3xl border border-purple-500/30 bg-[#0f172a] shadow-2xl shadow-purple-900/40 z-10 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-purple-500/20 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-600/20 text-purple-400 border border-purple-500/30">
              <Subtitles className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">자막 선택 및 수동 검색</h2>
              <p className="text-xs text-slate-400">
                현재 자막: <span className="text-purple-300 font-semibold">{currentSubName || "연동 중"}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-purple-500/15 bg-slate-900/60 px-6 pt-2">
          <button
            onClick={() => setActiveTab("creators")}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-bold transition ${
              activeTab === "creators"
                ? "border-purple-500 text-purple-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Users className="h-4 w-4" />
            제작자 선택 ({creators.length}명)
          </button>

          <button
            onClick={() => setActiveTab("search")}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-bold transition ${
              activeTab === "search"
                ? "border-purple-500 text-purple-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Search className="h-4 w-4" />
            다른 제목 검색
          </button>

          <button
            onClick={() => setActiveTab("file")}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-bold transition ${
              activeTab === "file"
                ? "border-purple-500 text-purple-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Upload className="h-4 w-4" />
            내 파일 직접 열기
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Tab 1: Creators List */}
          {activeTab === "creators" && (
            <div className="space-y-3">
              {creatorError && (
                <div className="flex items-center gap-2 rounded-xl bg-red-500/10 border border-red-500/30 p-3 text-xs text-red-400">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{creatorError}</span>
                </div>
              )}

              {creators.length === 0 ? (
                <div className="py-12 text-center text-slate-400">
                  <p className="text-sm font-semibold">등록된 공식 자막 제작자가 없습니다.</p>
                  <p className="mt-1 text-xs text-slate-500">
                    &apos;다른 제목 검색&apos; 탭에서 한국어 제목으로 직접 검색해 보세요.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {creators.map((c, idx) => {
                    const isCurrent = currentSubName?.includes(c.name);
                    const isLoading = loadingCreator === c.name;
                    const isAss =
                      c.name.includes("카이란") ||
                      c.name.includes("슈퍼소닉") ||
                      c.name.includes("코코아");

                    return (
                      <div
                        key={idx}
                        className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4 transition ${
                          isCurrent
                            ? "border-purple-500/60 bg-purple-950/20"
                            : "border-white/10 bg-slate-900/60 hover:border-purple-500/30"
                        }`}
                      >
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white text-sm">{c.name}</span>
                            {isAss && (
                              <span className="flex items-center gap-1 rounded-md bg-purple-500/20 border border-purple-500/40 px-2 py-0.5 text-[11px] font-bold text-purple-300">
                                <Wand2 className="h-3 w-3" />
                                ASS 특수효과
                              </span>
                            )}
                            {isCurrent && (
                              <span className="flex items-center gap-1 rounded-md bg-emerald-500/20 text-emerald-400 px-2 py-0.5 text-[11px] font-bold">
                                <Check className="h-3 w-3" /> 사용 중
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-slate-400">
                            <span>최신 업데이트: {c.episode || "확인됨"}</span>
                            {c.website && (
                              <a
                                href={c.website}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1 text-purple-400 hover:underline"
                              >
                                블로그 방문 <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                        </div>

                        <button
                          onClick={() => handleSelectCreator(c)}
                          disabled={isLoading || isCurrent}
                          className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition shadow-md ${
                            isCurrent
                              ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                              : isLoading
                              ? "bg-purple-600/50 text-white cursor-wait"
                              : "bg-purple-600 text-white hover:bg-purple-500 active:scale-95"
                          }`}
                        >
                          {isLoading ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              다운로드 중...
                            </>
                          ) : isCurrent ? (
                            "적용됨"
                          ) : (
                            "이 제작자 자막 적용"
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Tab 2: Manual Title Search */}
          {activeTab === "search" && (
            <div className="space-y-4">
              <form onSubmit={handleSearch} className="flex gap-2">
                <input
                  type="text"
                  value={searchKeyword}
                  onChange={(e) => setSearchKeyword(e.target.value)}
                  placeholder="한국어 작품명 입력 (예: 귀멸의 칼날, 장송의 프리렌)"
                  className="flex-1 rounded-xl border border-purple-500/30 bg-slate-900/90 px-4 py-2.5 text-xs text-white placeholder-slate-500 outline-none focus:border-purple-400"
                />
                <input
                  type="number"
                  value={searchEp}
                  onChange={(e) => setSearchEp(parseInt(e.target.value, 10) || 1)}
                  className="w-20 rounded-xl border border-purple-500/30 bg-slate-900/90 px-3 py-2.5 text-xs font-bold text-center text-white outline-none focus:border-purple-400"
                  min={1}
                />
                <button
                  type="submit"
                  disabled={isSearching}
                  className="flex items-center gap-1.5 rounded-xl bg-purple-600 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-purple-600/30 transition hover:bg-purple-500 disabled:opacity-50"
                >
                  {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  검색
                </button>
              </form>

              {searchError && (
                <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-3 text-xs text-red-400">
                  {searchError}
                </div>
              )}

              {/* Search Results */}
              <div className="space-y-2">
                {searchResults.map((sub, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-900/60 p-4 hover:border-purple-500/40 transition"
                  >
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-xs">{sub.name}</span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-extrabold ${
                            sub.is_ass
                              ? "bg-purple-500/20 text-purple-300 border border-purple-500/40"
                              : "bg-sky-500/20 text-sky-300 border border-sky-500/40"
                          }`}
                        >
                          {sub.format}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 line-clamp-1">
                        자막 내용 {sub.content?.length || 0}자 포함
                      </p>
                    </div>

                    <button
                      onClick={() => {
                        onSelectSubtitle(sub);
                        onClose();
                      }}
                      className="rounded-xl bg-purple-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-purple-500 active:scale-95"
                    >
                      선택
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tab 3: Local File Upload */}
          {activeTab === "file" && (
            <div className="space-y-4">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center cursor-pointer transition ${
                  isDragging
                    ? "border-purple-400 bg-purple-950/30"
                    : "border-purple-500/30 bg-slate-900/40 hover:border-purple-500 hover:bg-slate-900/60"
                }`}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-600/20 text-purple-400 mb-3 border border-purple-500/30">
                  <Upload className="h-6 w-6" />
                </div>
                <h4 className="text-sm font-bold text-white">자막 파일을 이곳에 드래그하거나 클릭하여 선택하세요</h4>
                <p className="mt-1 text-xs text-slate-400">
                  지원 확장자: <strong>.ass, .ssa, .srt, .smi, .vtt</strong>
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".ass,.ssa,.srt,.smi,.vtt"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </div>

              {fileError && (
                <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-3 text-xs text-red-400">
                  {fileError}
                </div>
              )}

              {uploadedSub && (
                <div className="flex items-center justify-between rounded-2xl border border-emerald-500/40 bg-emerald-950/20 p-4">
                  <div className="flex items-center gap-3">
                    <FileText className="h-6 w-6 text-emerald-400" />
                    <div>
                      <h5 className="text-xs font-bold text-white">{uploadedSub.name}</h5>
                      <span className="text-[11px] text-emerald-400 font-semibold">
                        형식: {uploadedSub.format} • 준비 완료
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      onSelectSubtitle(uploadedSub);
                      onClose();
                    }}
                    className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-emerald-500 shadow-lg shadow-emerald-600/30"
                  >
                    이 자막으로 재생
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
