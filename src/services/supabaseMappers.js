export function alunoParaBanco(aluno) {
  return {
    id: uuidValido(aluno.id) ? aluno.id : undefined,
    nome: aluno.nome,
    telefone: aluno.telefone || null,
    faixa: aluno.faixa || null,
    turma: aluno.turma || "Adultos",
    grau: aluno.grau || null,
    responsavel: aluno.responsavel || null,
    data_nascimento: converterDataBrasilParaISO(aluno.dataNascimento),
    data_inicio: converterDataBrasilParaISO(aluno.dataInicio),
    peso: aluno.peso ? Number(aluno.peso) : null,
    mensalidade: Number(aluno.mensalidade || 0),
    vencimento: aluno.vencimento ? Number(aluno.vencimento) : null,
    status_pagamento: aluno.statusPagamento || "Pendente",
    ultimo_pagamento: converterDataBrasilParaISO(aluno.ultimoPagamento),
    tipo_sanguineo: aluno.tipoSanguineo || null,
    saude: aluno.saude || null,
    medicamentos: aluno.medicamentos || null,
    observacoes: aluno.observacoes || null,
    observacao_financeira: aluno.observacaoFinanceira || null,
    foto_url: aluno.fotoUrl || aluno.foto || null,
    academia_id: aluno.academiaId || aluno.academia_id || undefined,
    auth_user_id: aluno.authUserId || aluno.auth_user_id || undefined,
  };
}

export function alunoDoBanco(linha) {
  return {
    id: linha.id,
    nome: linha.nome || "",
    telefone: linha.telefone || "",
    faixa: linha.faixa || "",
    turma: linha.turma || "Adultos",
    grau: linha.grau || "",
    responsavel: linha.responsavel || "",
    dataNascimento: linha.data_nascimento || "",
    dataInicio: linha.data_inicio || "",
    peso: linha.peso || "",
    mensalidade: Number(linha.mensalidade || 0),
    vencimento: Number(linha.vencimento || 0),
    statusPagamento: linha.status_pagamento || "Pendente",
    ultimoPagamento: converterDataISOParaBrasil(linha.ultimo_pagamento),
    tipoSanguineo: linha.tipo_sanguineo || "",
    saude: linha.saude || "",
    medicamentos: linha.medicamentos || "",
    observacoes: linha.observacoes || "",
    observacaoFinanceira: linha.observacao_financeira || "",
    foto: "",
    fotoUrl: linha.foto_url || "",
    academiaId: linha.academia_id || "",
    authUserId: linha.auth_user_id || "",
    presencas: [],
    historicoPagamentos: [],
  };
}

export function presencaParaBanco(presenca) {
  return {
    aluno_id: presenca.alunoId,
    data: converterDataBrasilParaISO(presenca.data) || new Date().toISOString().slice(0, 10),
    hora: presenca.hora || new Date().toLocaleTimeString(),
  };
}

export function presencaDoBanco(linha) {
  return {
    id: linha.id,
    alunoId: linha.aluno_id,
    nome: linha.alunos?.nome || "",
    foto: linha.alunos?.foto_url || "",
    data: converterDataISOParaBrasil(linha.data),
    hora: linha.hora || "",
  };
}

function converterDataBrasilParaISO(data) {
  if (!data) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(data)) return data;

  const partes = String(data).split("/");

  if (partes.length !== 3) return null;

  const [dia, mes, ano] = partes;
  if (!dia || !mes || !ano || ano.length !== 4) return null;

  return `${ano}-${mes.padStart(2, "0")}-${dia.padStart(2, "0")}`;
}

function uuidValido(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(id || "")
  );
}

function converterDataISOParaBrasil(data) {
  if (!data) return "";
  if (data.includes("/")) return data;

  const partes = data.split("-");

  if (partes.length !== 3) return data;

  return partes.reverse().join("/");
}
