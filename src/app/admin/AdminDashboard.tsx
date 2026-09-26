"use client";

import { useState, useEffect } from "react";
import { UserPlus, Trash2, RefreshCw, Shield, ShieldOff, KeyRound, Check, X, AlertCircle, Eye, EyeOff } from "lucide-react";

type User = {
  id: number;
  username: string;
  nickname: string;
  is_admin: boolean;
  is_active: boolean;
  is_first_login: boolean;
  created_at: string;
};

export default function AdminDashboard({
  currentUser,
}: {
  currentUser: { id: number; username: string; nickname: string; isAdmin: boolean };
}) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  
  // Create Form State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createUsername, setCreateUsername] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createNickname, setCreateNickname] = useState("");
  const [createdUserMsg, setCreatedUserMsg] = useState<{ user: string; pass: string } | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Row states
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [resetPassId, setResetPassId] = useState<number | null>(null);
  const [tempResetPass, setTempResetPass] = useState("");

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/users");
      const data = await res.json();
      if (data.success) {
        setUsers(data.users);
      } else {
        setError(data.message || "사용자 목록을 불러오지 못했습니다.");
      }
    } catch (err) {
      setError("서버 통신 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 5000);
  };
  
  const showError = (msg: string) => {
    setError(msg);
    setTimeout(() => setError(null), 5000);
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setCreatedUserMsg(null);

    if (!createUsername || !createPassword) {
      showError("아이디와 임시 비밀번호를 입력해주세요.");
      return;
    }

    setIsCreating(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: createUsername,
          tempPassword: createPassword,
          nickname: createNickname || undefined,
        }),
      });
      const data = await res.json();

      if (data.success) {
        showSuccess("새 계정이 생성되었습니다.");
        setCreatedUserMsg({ user: createUsername, pass: createPassword });
        setCreateUsername("");
        setCreatePassword("");
        setCreateNickname("");
        fetchUsers();
      } else {
        showError(data.message || "계정 생성 실패");
      }
    } catch (err) {
      showError("서버 오류가 발생했습니다.");
    } finally {
      setIsCreating(false);
    }
  };

  const handleToggleActive = async (id: number, currentStatus: boolean) => {
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle_active", isActive: !currentStatus }),
      });
      const data = await res.json();
      if (data.success) {
        showSuccess(`계정이 ${!currentStatus ? '활성화' : '비활성화'} 되었습니다.`);
        setUsers(users.map(u => u.id === id ? { ...u, is_active: !currentStatus } : u));
      } else {
        showError(data.message || "상태 변경 실패");
      }
    } catch (err) {
      showError("상태 변경 중 오류가 발생했습니다.");
    }
  };

  const handleResetPassword = async (id: number) => {
    if (!tempResetPass) {
      showError("임시 비밀번호를 입력해주세요.");
      return;
    }
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset_password", tempPassword: tempResetPass }),
      });
      const data = await res.json();
      if (data.success) {
        showSuccess("비밀번호가 초기화되었습니다.");
        setResetPassId(null);
        setTempResetPass("");
      } else {
        showError(data.message || "비밀번호 초기화 실패");
      }
    } catch (err) {
      showError("초기화 중 오류가 발생했습니다.");
    }
  };

  const handleDeleteUser = async (id: number) => {
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        showSuccess("계정이 삭제되었습니다.");
        setUsers(users.filter(u => u.id !== id));
        setConfirmDeleteId(null);
      } else {
        showError(data.message || "삭제 실패");
      }
    } catch (err) {
      showError("삭제 중 오류가 발생했습니다.");
    }
  };

  const generateRandomPassword = () => {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
    let pass = "";
    for (let i = 0; i < 10; i++) pass += chars.charAt(Math.floor(Math.random() * chars.length));
    setCreatePassword(pass);
  };

  return (
    <div className="min-h-screen bg-[#060913] p-6 pt-24 text-white">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-indigo-400 bg-clip-text text-transparent">
              계정 관리
            </h1>
            <p className="mt-2 text-sm text-slate-400">시스템 사용자들을 관리합니다.</p>
          </div>
        </div>

        {error && (
          <div className="mb-6 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-950/40 p-4 text-sm text-red-300">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <p>{error}</p>
          </div>
        )}
        
        {successMsg && (
          <div className="mb-6 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/40 p-4 text-sm text-emerald-300">
            <Check className="h-5 w-5 shrink-0" />
            <p>{successMsg}</p>
          </div>
        )}

        <div className="mb-8 rounded-3xl border border-white/10 bg-[#0d1426]/70 p-6 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-200">사용자 생성</h2>
            <button
              onClick={() => setIsCreateOpen(!isCreateOpen)}
              className="flex items-center gap-2 rounded-xl bg-purple-600/20 px-4 py-2 text-sm font-medium text-purple-300 transition hover:bg-purple-600/30"
            >
              <UserPlus className="h-4 w-4" />
              {isCreateOpen ? "닫기" : "새 계정 추가"}
            </button>
          </div>

          {isCreateOpen && (
            <div className="mt-6 border-t border-white/10 pt-6">
              <form onSubmit={handleCreateUser} className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300">아이디 *</label>
                  <input
                    type="text"
                    value={createUsername}
                    onChange={(e) => setCreateUsername(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-[#060913]/70 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 transition focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                    placeholder="user123"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300">임시 비밀번호 *</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={createPassword}
                      onChange={(e) => setCreatePassword(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-[#060913]/70 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 transition focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                      placeholder="password"
                    />
                    <button
                      type="button"
                      onClick={generateRandomPassword}
                      className="rounded-xl border border-white/10 bg-slate-800/80 px-3 py-2 text-slate-300 transition hover:bg-slate-700"
                      title="랜덤 생성"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300">닉네임 (선택)</label>
                  <input
                    type="text"
                    value={createNickname}
                    onChange={(e) => setCreateNickname(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-[#060913]/70 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 transition focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                    placeholder="길동이"
                  />
                </div>
                <div className="col-span-full mt-2">
                  <button
                    type="submit"
                    disabled={isCreating}
                    className="w-full rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 py-3 text-sm font-bold text-white shadow-lg shadow-purple-600/30 transition hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50"
                  >
                    {isCreating ? "생성 중..." : "계정 생성"}
                  </button>
                </div>
              </form>

              {createdUserMsg && (
                <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-950/40 p-4">
                  <p className="text-sm font-medium text-emerald-300 mb-2">계정이 성공적으로 생성되었습니다. 아래 정보를 사용자에게 전달해주세요.</p>
                  <div className="bg-black/50 p-3 rounded-lg flex flex-col gap-1 text-sm font-mono text-emerald-100">
                    <div><span className="text-emerald-500/70">ID:</span> {createdUserMsg.user}</div>
                    <div><span className="text-emerald-500/70">PW:</span> {createdUserMsg.pass}</div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-white/10 bg-[#0d1426]/70 p-6 shadow-2xl backdrop-blur-xl">
          <h2 className="mb-6 text-lg font-semibold text-slate-200">사용자 목록</h2>
          
          {loading ? (
            <div className="py-12 text-center text-slate-400 flex flex-col items-center">
              <RefreshCw className="h-8 w-8 animate-spin mb-4 text-purple-500" />
              불러오는 중...
            </div>
          ) : users.length === 0 ? (
            <div className="py-12 text-center text-slate-400">
              표시할 사용자가 없습니다.
            </div>
          ) : (
            <div className="grid gap-4">
              {users.map((user) => {
                const isMe = user.id === currentUser.id;
                
                return (
                  <div key={user.id} className="flex flex-col gap-4 rounded-2xl border border-white/5 bg-slate-800/30 p-5 md:flex-row md:items-center md:justify-between">
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-3">
                        <span className="font-semibold text-slate-200">{user.username}</span>
                        {user.nickname && <span className="text-sm text-slate-400">{user.nickname}</span>}
                        {user.is_admin && (
                          <span className="rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 px-2 py-0.5 text-[10px] font-bold text-white">
                            ADMIN
                          </span>
                        )}
                        {!user.is_active && (
                          <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-bold text-red-400 border border-red-500/30">
                            비활성화됨
                          </span>
                        )}
                        {user.is_first_login && (
                          <span className="rounded-full bg-purple-500/20 px-2 py-0.5 text-[10px] font-bold text-purple-400 border border-purple-500/30">
                            초기상태
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500">
                        가입일: {new Date(user.created_at).toLocaleDateString()}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {resetPassId === user.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={tempResetPass}
                            onChange={(e) => setTempResetPass(e.target.value)}
                            placeholder="새 임시 비밀번호"
                            className="w-32 rounded-lg border border-white/10 bg-[#060913]/70 px-2 py-1.5 text-xs text-white placeholder-slate-500 focus:border-purple-500 focus:outline-none"
                          />
                          <button
                            onClick={() => handleResetPassword(user.id)}
                            className="rounded-lg bg-emerald-500/20 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/30"
                          >
                            저장
                          </button>
                          <button
                            onClick={() => { setResetPassId(null); setTempResetPass(""); }}
                            className="rounded-lg bg-slate-700/50 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700"
                          >
                            취소
                          </button>
                        </div>
                      ) : confirmDeleteId === user.id ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-red-400 font-medium">정말 삭제하시겠습니까?</span>
                          <button
                            onClick={() => handleDeleteUser(user.id)}
                            className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-bold text-white shadow-lg shadow-red-500/30 hover:bg-red-600"
                          >
                            삭제
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="rounded-lg bg-slate-700/50 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700"
                          >
                            취소
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={() => handleToggleActive(user.id, user.is_active)}
                            disabled={isMe}
                            title={user.is_active ? "계정 비활성화" : "계정 활성화"}
                            className={`flex h-8 w-8 items-center justify-center rounded-xl border border-white/5 transition disabled:opacity-30 disabled:cursor-not-allowed ${
                              user.is_active 
                                ? "bg-slate-800/80 text-slate-400 hover:bg-amber-500/20 hover:text-amber-400 hover:border-amber-500/30" 
                                : "bg-slate-800/80 text-slate-400 hover:bg-emerald-500/20 hover:text-emerald-400 hover:border-emerald-500/30"
                            }`}
                          >
                            {user.is_active ? <ShieldOff className="h-4 w-4" /> : <Shield className="h-4 w-4" />}
                          </button>
                          <button
                            onClick={() => setResetPassId(user.id)}
                            title="비밀번호 초기화"
                            className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/5 bg-slate-800/80 text-slate-400 transition hover:bg-purple-500/20 hover:text-purple-400 hover:border-purple-500/30"
                          >
                            <KeyRound className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(user.id)}
                            disabled={isMe}
                            title="계정 삭제"
                            className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/5 bg-slate-800/80 text-slate-400 transition hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/30 disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
