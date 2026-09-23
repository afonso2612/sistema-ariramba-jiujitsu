import { supabase } from "../lib/supabaseClient";

export const LIMITE_COMPROVANTE = 5 * 1024 * 1024;
const TIPOS = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };

export function validarComprovante(arquivo) {
  const extensao = arquivo?.name?.split(".").pop().toLowerCase();
  if (!TIPOS[extensao] || (arquivo.type && arquivo.type !== TIPOS[extensao])) {
    throw new Error("Selecione somente PDF, JPG, JPEG ou PNG.");
  }
  if (!arquivo.size || arquivo.size > LIMITE_COMPROVANTE) {
    throw new Error("O comprovante deve ter conteúdo e no máximo 5 MiB.");
  }
  return extensao;
}

export async function enviarPagamentoComComprovante(pagamento, arquivo) {
  const extensao = validarComprovante(arquivo);
  // Verifica também a assinatura do arquivo, sem converter para base64.
  const bytes = new Uint8Array(await arquivo.slice(0, 8).arrayBuffer());
  const assinaturas = {
    pdf: [0x25, 0x50, 0x44, 0x46, 0x2d],
    jpg: [0xff, 0xd8, 0xff],
    jpeg: [0xff, 0xd8, 0xff],
    png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  };
  if (!assinaturas[extensao].every((byte, i) => bytes[i] === byte)) {
    throw new Error("O conteúdo do arquivo não corresponde ao formato informado.");
  }
  if (!supabase) throw new Error("Supabase não configurado.");
  const { data: sessao, error: erroSessao } = await supabase.auth.getSession();
  if (erroSessao) throw erroSessao;
  if (!sessao.session) throw new Error("Entre com sua conta autenticada para enviar comprovantes.");
  const { data: perfil, error: erroPerfil } = await supabase.from("profiles")
    .select("academia_id, aluno_id").eq("id", sessao.session.user.id).single();
  if (erroPerfil) throw erroPerfil;
  if (!perfil?.academia_id || perfil.aluno_id !== pagamento.aluno_id) {
    throw new Error("O comprovante precisa pertencer ao aluno autenticado.");
  }
  const id = pagamento.id || crypto.randomUUID();
  const caminho = `${perfil.academia_id}/${pagamento.aluno_id}/${id}.${extensao}`;
  const { error: erroUpload } = await supabase.storage.from("comprovantes")
    .upload(caminho, arquivo, { contentType: TIPOS[extensao], upsert: true });
  if (erroUpload) throw erroUpload;

  // A autorização efetiva é feita no banco, por auth.uid()/profiles.
  const resultado = pagamento.id
    ? await supabase.rpc("vincular_comprovante_pagamento", { pagamento_id: id, caminho })
    : await supabase.from("pagamentos").insert({ ...pagamento, id, comprovante_url: caminho });
  if (resultado.error) {
    // Não remover: uma resposta perdida pode esconder uma gravação concluída.
    throw new Error(`Arquivo enviado, mas não foi possível confirmar o vínculo do pagamento. Atualize antes de tentar novamente. ${resultado.error.message}`);
  }
  return caminho;
}

export async function obterUrlComprovante(caminho) {
  if (!supabase) throw new Error("Supabase não configurado.");
  const { data, error } = await supabase.storage.from("comprovantes")
    .createSignedUrl(caminho, 60);
  if (error) throw error;
  return data.signedUrl;
}
