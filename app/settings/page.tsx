"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const C = {
  bg: "#f3f5f9",
  surface: "#ffffff",
  ink: "#0f172a",
  inkDim: "#64748b",
  inkFaint: "#94a3b8",
  line: "#e2e8f0",
  primary: "#2563eb",
  primaryLight: "#dbeafe",
  red: "#dc2626",
  redBg: "#fef2f2",
  mono: "'Space Mono', monospace",
};

const Icon = {
  back: (s = 18) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  ),
  user: (s = 16) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  lock: (s = 16) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0110 0v4" />
    </svg>
  ),
  alertTriangle: (s = 16) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10.3 3.9L2.2 18a2 2 0 001.7 3h16.2a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  ),
};

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ background: C.surface, borderRadius: 16, border: `1px solid ${C.line}`, padding: 18, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: C.primaryLight, color: C.primary, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {icon}
        </div>
        <span style={{ fontSize: 14.5, fontWeight: 800, color: C.ink }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [uid, setUid] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [companyId, setCompanyId] = useState<string>("");
  const [role, setRole] = useState<string>("");
  const [superAdmin, setSuperAdmin] = useState(false);

  const [name, setName] = useState("");
  const [nameSaving, setNameSaving] = useState(false);

  const [pwSending, setPwSending] = useState(false);
  const [pwSent, setPwSent] = useState(false);

  const [showWithdrawConfirm, setShowWithdrawConfirm] = useState(false);
  const [withdrawAgree, setWithdrawAgree] = useState(false);
  const [withdrawTyped, setWithdrawTyped] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { router.push("/login"); return; }
      setUid(session.user.id);
      setEmail(session.user.email || "");

      const { data } = await supabase.from("users")
        .select("name, role, company_id, team, super_admin, is_active")
        .eq("id", session.user.id).single();

      if (!data) { router.push("/login"); return; }
      if (data.is_active === false) {
        await supabase.auth.signOut();
        alert("탈퇴 처리된 계정입니다.");
        router.push("/login");
        return;
      }
      setName(data.name || "");
      setRole(data.role || "");
      setCompanyId(data.company_id || "");
      setSuperAdmin(data.super_admin === true);
      setLoading(false);
    };
    init();
  }, [router]);

  const isAdmin = role === "admin" || superAdmin;

  const handleSaveName = async () => {
    if (!name.trim()) { alert("이름을 입력해주세요."); return; }
    setNameSaving(true);
    try {
      const { error } = await supabase.from("users").update({ name: name.trim() }).eq("id", uid);
      if (error) throw error;
      alert("저장되었습니다.");
    } catch (e: any) {
      alert("저장 실패: " + e.message);
    } finally {
      setNameSaving(false);
    }
  };

  const handleSendPasswordReset = async () => {
    if (!email) { alert("계정 이메일을 확인할 수 없습니다."); return; }
    setPwSending(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setPwSent(true);
    } catch (e: any) {
      alert("메일 발송 실패: " + e.message);
    } finally {
      setPwSending(false);
    }
  };

  const handleWithdraw = async () => {
    if (!withdrawAgree) { alert("안내 사항에 동의해주세요."); return; }
    if (withdrawTyped !== "탈퇴합니다") { alert('"탈퇴합니다"를 정확히 입력해주세요.'); return; }

    setWithdrawing(true);
    try {
      if (isAdmin) {
        const { count, error: cntErr } = await supabase
          .from("users")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .or("role.eq.admin,super_admin.eq.true")
          .eq("is_active", true)
          .neq("id", uid);
        if (cntErr) throw cntErr;
        if (!count || count === 0) {
          alert("현재 회사 내 유일한 관리자입니다.\n다른 팀원을 관리자로 지정한 뒤 탈퇴해주세요.");
          setWithdrawing(false);
          return;
        }
      }

      const { error } = await supabase.from("users").update({
        is_active: false,
        deactivated_at: new Date().toISOString(),
      }).eq("id", uid);
      if (error) throw error;

      await supabase.auth.signOut();
      alert("탈퇴 처리되었습니다. 그동안 이용해주셔서 감사합니다.");
      router.push("/login");
    } catch (e: any) {
      alert("탈퇴 처리 실패: " + e.message);
    } finally {
      setWithdrawing(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: C.inkDim }}>불러오는 중...</div>;
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.ink, paddingBottom: 60 }}>
      <div style={{ padding: "20px 20px 8px", display: "flex", alignItems: "center", gap: 10 }}>
        <div
          onClick={() => router.push("/work")}
          style={{
            width: 36, height: 36, borderRadius: 10, background: "#fff",
            border: `1px solid ${C.line}`, display: "flex", alignItems: "center",
            justifyContent: "center", cursor: "pointer", color: C.inkDim,
          }}
        >
          {Icon.back(18)}
        </div>
        <span style={{ fontSize: 17, fontWeight: 800 }}>설정</span>
      </div>

      <div style={{ maxWidth: 480, margin: "0 auto", padding: "16px 16px 0" }}>

        {/* 개인정보 변경 */}
        <Card title="개인정보" icon={Icon.user(14)}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11.5, color: C.inkDim, fontWeight: 700, display: "block", marginBottom: 6 }}>이름</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.line}`, fontSize: 14 }}
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11.5, color: C.inkDim, fontWeight: 700, display: "block", marginBottom: 6 }}>이메일</label>
            <input value={email} disabled
              style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.line}`, fontSize: 14, background: "#f8fafc", color: C.inkFaint }} />
          </div>
          <button
            onClick={handleSaveName}
            disabled={nameSaving}
            style={{ width: "100%", padding: "12px", borderRadius: 10, border: "none", background: C.primary, color: "#fff", fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}
          >
            {nameSaving ? "저장 중..." : "저장하기"}
          </button>
        </Card>

        {/* 비밀번호 변경 */}
        <Card title="비밀번호 변경" icon={Icon.lock(14)}>
          <p style={{ fontSize: 12.5, color: C.inkDim, marginBottom: 14, lineHeight: 1.5 }}>
            가입하신 이메일({email})로 비밀번호 재설정 링크를 보내드립니다.<br />
            메일함에서 링크를 눌러 새 비밀번호를 설정해주세요.
          </p>
          <button
            onClick={handleSendPasswordReset}
            disabled={pwSending || pwSent}
            style={{
              width: "100%", padding: "12px", borderRadius: 10, border: `1px solid ${C.primary}`,
              background: pwSent ? "#f0fdf4" : "#fff", color: pwSent ? "#059669" : C.primary,
              fontWeight: 700, fontSize: 13.5, cursor: pwSent ? "default" : "pointer",
            }}
          >
            {pwSending ? "발송 중..." : pwSent ? "재설정 메일을 보냈습니다" : "비밀번호 재설정 메일 보내기"}
          </button>
        </Card>

        {/* 회원 탈퇴 */}
        <Card title="회원 탈퇴" icon={Icon.alertTriangle(14)}>
          {!showWithdrawConfirm ? (
            <>
              <p style={{ fontSize: 12.5, color: C.inkDim, marginBottom: 14, lineHeight: 1.5 }}>
                탈퇴 시 더 이상 이 계정으로 로그인할 수 없습니다.<br />
                신중하게 결정해주세요.
              </p>
              <button
                onClick={() => setShowWithdrawConfirm(true)}
                style={{ width: "100%", padding: "12px", borderRadius: 10, border: `1px solid ${C.red}`, background: "#fff", color: C.red, fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}
              >
                회원 탈퇴하기
              </button>
            </>
          ) : (
            <div>
              <div style={{ background: C.redBg, border: `1px solid #fecaca`, borderRadius: 10, padding: 14, marginBottom: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: C.red, marginBottom: 6 }}>정말 탈퇴하시겠습니까?</div>
                <div style={{ fontSize: 12, color: "#991b1b", lineHeight: 1.6 }}>
                  탈퇴 즉시 계정 정보가 삭제되며, 이 작업은 되돌릴 수 없습니다.<br />
                  탈퇴 후에는 동일한 계정으로 다시 로그인할 수 없으니 신중하게 진행해주세요.
                </div>
              </div>

              <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 12, fontSize: 12.5, color: C.ink, cursor: "pointer" }}>
                <input type="checkbox" checked={withdrawAgree} onChange={e => setWithdrawAgree(e.target.checked)} style={{ marginTop: 2 }} />
                <span>위 내용을 확인했으며, 탈퇴에 동의합니다.</span>
              </label>

              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11.5, color: C.inkDim, fontWeight: 700, display: "block", marginBottom: 6 }}>
                  계속하려면 아래 입력창에 <strong style={{ color: C.red }}>탈퇴합니다</strong> 를 입력해주세요.
                </label>
                <input
                  value={withdrawTyped}
                  onChange={e => setWithdrawTyped(e.target.value)}
                  placeholder="탈퇴합니다"
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.line}`, fontSize: 14 }}
                />
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => { setShowWithdrawConfirm(false); setWithdrawAgree(false); setWithdrawTyped(""); }}
                  style={{ flex: 1, padding: "12px", borderRadius: 10, border: `1px solid ${C.line}`, background: "#fff", color: C.inkDim, fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}
                >
                  취소
                </button>
                <button
                  onClick={handleWithdraw}
                  disabled={withdrawing}
                  style={{ flex: 1, padding: "12px", borderRadius: 10, border: "none", background: C.red, color: "#fff", fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}
                >
                  {withdrawing ? "처리 중..." : "탈퇴 확정"}
                </button>
              </div>
            </div>
          )}
        </Card>

      </div>
    </div>
  );
}
