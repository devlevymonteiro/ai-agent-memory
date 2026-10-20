class_name PieceModelLoader
extends RefCounted

## Carregador e normalizador de modelos 3D das peças.
##
## Resolve 3 problemas reais de usar pack pronto:
##   1. Nomenclatura inconsistente entre packs -> varredura + casamento por
##      palavra-chave, funciona sem renomear nada.
##   2. Escala/origem arbitrárias -> normaliza altura por tipo, centraliza
##      X/Z e assenta a base em Y = 0.
##   3. Cor -> material compartilhado por cor/estado (4 no total), ou mantém
##      o material PBR original quando o pack já vem em madeira clara/escura.
##
## Ordem de resolução: arquivo por cor -> arquivo neutro -> sub-cena dentro
## de um arquivo combinado -> primitiva procedural (fallback).

const MODELS_DIR := "res://assets/models/pieces/"
const EXTENSIONS := ["glb", "gltf"]
const MAX_FOOTPRINT := 0.82   # casas têm 1.0 de lado; folga pra não encostar
const CYLINDER_SEGMENTS := 16
const SPHERE_SEGMENTS := 14
const SPHERE_RINGS := 8

## Palavras-chave aceitas para cada peça (minúsculas, testadas com contains).
const KEYWORDS := {
	&"pawn": ["pawn", "peao", "peon", "bauer", "soldier"],
	&"knight": ["knight", "horse", "cavalo", "springer"],
	&"bishop": ["bishop", "bispo", "laeufer", "lauf"],
	&"rook": ["rook", "castle", "torre", "turm"],
	&"queen": ["queen", "rainha", "dame"],
	&"king": ["king", "rei", "koenig", "konig"],
}

## Altura alvo em casas (1 casa = 1.0). Proporção Staunton aproximada.
const TARGET_HEIGHT := {
	&"pawn": 0.55, &"knight": 0.72, &"bishop": 0.82,
	&"rook": 0.62, &"queen": 0.98, &"king": 1.12,
}

## Perfil procedural de fallback: cilindro/sphere/box empilhados.
const FALLBACK_SPEC := {
	&"pawn": [
		{"t": "cyl", "rt": 0.17, "rb": 0.24, "h": 0.10, "y": 0.05},
		{"t": "cyl", "rt": 0.10, "rb": 0.14, "h": 0.30, "y": 0.25},
		{"t": "sph", "r": 0.13, "y": 0.46},
	],
	&"rook": [
		{"t": "cyl", "rt": 0.20, "rb": 0.26, "h": 0.10, "y": 0.05},
		{"t": "cyl", "rt": 0.16, "rb": 0.19, "h": 0.34, "y": 0.27},
		{"t": "cyl", "rt": 0.21, "rb": 0.18, "h": 0.09, "y": 0.48},
	],
	&"knight": [
		{"t": "cyl", "rt": 0.19, "rb": 0.25, "h": 0.10, "y": 0.05},
		{"t": "cyl", "rt": 0.13, "rb": 0.16, "h": 0.18, "y": 0.19},
		{"t": "box", "s": [0.20, 0.30, 0.34], "y": 0.42, "rx": -20.0},
	],
	&"bishop": [
		{"t": "cyl", "rt": 0.19, "rb": 0.25, "h": 0.10, "y": 0.05},
		{"t": "cyl", "rt": 0.10, "rb": 0.16, "h": 0.30, "y": 0.25},
		{"t": "sph", "r": 0.15, "y": 0.50},
		{"t": "sph", "r": 0.06, "y": 0.62},
	],
	&"queen": [
		{"t": "cyl", "rt": 0.22, "rb": 0.28, "h": 0.10, "y": 0.05},
		{"t": "cyl", "rt": 0.11, "rb": 0.19, "h": 0.42, "y": 0.31},
		{"t": "sph", "r": 0.16, "y": 0.60},
		{"t": "sph", "r": 0.07, "y": 0.74},
	],
	&"king": [
		{"t": "cyl", "rt": 0.22, "rb": 0.28, "h": 0.10, "y": 0.05},
		{"t": "cyl", "rt": 0.12, "rb": 0.19, "h": 0.46, "y": 0.33},
		{"t": "sph", "r": 0.15, "y": 0.63},
		{"t": "box", "s": [0.05, 0.20, 0.05], "y": 0.74},
		{"t": "box", "s": [0.16, 0.05, 0.05], "y": 0.76},
	],
}

const WHITE_COLOR := Color("f2ece0")
const BLACK_COLOR := Color("2b2f36")
const HIGHLIGHT_COLOR := Color("f6f76b")
const HIGHLIGHT_ENERGY := 0.9

var _index: Dictionary = {}          # type -> {"white"/"black"/"neutral": path}
var _combined: Array[String] = []    # arquivos com várias peças dentro
var _scenes: Dictionary = {}         # path -> PackedScene (cache)
var _materials: Dictionary = {}      # chave -> Material compartilhado
var _uses_flat_materials := true

var _fallback_count := 0


func _init(force_flat_materials := false) -> void:
	_uses_flat_materials = force_flat_materials
	_scan_models_dir()
	_build_materials()


# ------------------------------------------------------------- API pública --

## Devolve um Node3D normalizado, pronto para ser filho de uma Piece.
func create_piece(type: StringName, is_white: bool) -> Node3D:
	var model := _resolve_model(type, is_white)
	var used_asset := model != null

	if model == null:
		model = _build_fallback(type, _material(&"flat", is_white, false))
		_fallback_count += 1

	if used_asset and _should_override_material(type, is_white):
		_apply_material(model, _material(&"flat", is_white, false))

	_normalize(model, type)
	model.set_meta(&"loader_type", type)
	model.set_meta(&"loader_white", is_white)
	model.set_meta(&"loader_flat", (not used_asset) or _should_override_material(type, is_white))
	return model


## Alterna destaque. Troca material quando usa os compartilhados;
## caso contrário clona por peça e mexe na emissão.
func apply_highlight(model: Node3D, highlighted: bool) -> void:
	if model == null:
		return

	var is_white: bool = model.get_meta(&"loader_white", true)
	var flat: bool = model.get_meta(&"loader_flat", true)

	if flat:
		_apply_material(model, _material(&"flat", is_white, highlighted))
		return

	for child in model.find_children("*", "MeshInstance3D", true, false):
		var mi := child as MeshInstance3D
		for i in mi.mesh.get_surface_count():
			var mat := mi.get_surface_override_material(i)
			if mat == null:
				mat = mi.mesh.surface_get_material(i)
			if mat == null:
				continue
			var own := mat as StandardMaterial3D
			if own and own.get_meta(&"cloned", false) != true:
				own = own.duplicate() as StandardMaterial3D
				own.set_meta(&"cloned", true)
			if own == null:
				continue
			own.emission_enabled = highlighted
			if highlighted:
				own.emission = HIGHLIGHT_COLOR
				own.emission_energy_multiplier = HIGHLIGHT_ENERGY
			mi.set_surface_override_material(i, own)


func has_model(type: StringName) -> bool:
	return _index.has(type) or not _combined.is_empty()


func fallback_count() -> int:
	return _fallback_count


## Útil no WSL: imprime exatamente o que o loader encontrou.
func debug_report() -> void:
	print("── PieceModelLoader ──────────────────────────────")
	print("dir: ", MODELS_DIR)
	if _index.is_empty() and _combined.is_empty():
		print("nenhum .glb/.gltf encontrado -> 100% procedural")
	for type in KEYWORDS:
		var entry: Dictionary = _index.get(type, {})
		print("  ", type,
			"\n      white:   ", String(entry.get("white", "")).get_file(),
			"\n      black:   ", String(entry.get("black", "")).get_file(),
			"\n      neutral: ", String(entry.get("neutral", "")).get_file())
	print("arquivos combinados: ", _combined.size())
	print("materiais planos: ", _uses_flat_materials)
	print("─────────────────────────────────────────────────")


# ---------------------------------------------------------- varredura -------

func _scan_models_dir() -> void:
	var dir := DirAccess.open(MODELS_DIR)
	if dir == null:
		push_warning("[piece_model_loader] pasta ausente: %s" % MODELS_DIR)
		return

	dir.list_dir_begin()
	var file_name := dir.get_next()
	while file_name != "":
		if not dir.current_is_dir():
			_classify(file_name)
		file_name = dir.get_next()
	dir.list_dir_end()


func _classify(file_name: String) -> void:
	if not EXTENSIONS.has(file_name.get_extension().to_lower()):
		return

	var stem := file_name.get_basename().to_lower()
	var path := MODELS_DIR.path_join(file_name)
	var type := _match_type(stem)

	if type == &"":
		# Pode ser um arquivo único com todas as peças dentro.
		if _looks_chessy(stem):
			_combined.append(path)
		return

	var entry: Dictionary = _index.get_or_add(type, {"white": "", "black": "", "neutral": ""})
	match _match_color(stem):
		&"white": entry["white"] = path
		&"black": entry["black"] = path
		_: entry["neutral"] = path


func _match_type(stem: String) -> StringName:
	for type in KEYWORDS:
		for kw in KEYWORDS[type]:
			if stem.contains(kw):
				return type
	return &""


func _match_color(stem: String) -> StringName:
	var white_words := ["white", "light", "clara", "blanc", "weiss"]
	var black_words := ["black", "dark", "preta", "noir", "schwarz"]
	for w in white_words:
		if stem.contains(w):
			return &"white"
	for b in black_words:
		if stem.contains(b):
			return &"black"
	return &""


func _looks_chessy(stem: String) -> bool:
	for kw in ["chess", "xadrez", "pieces", "pecas", "peças", "set"]:
		if stem.contains(kw):
			return true
	return false


# ----------------------------------------------------------- resolução -----

func _resolve_model(type: StringName, is_white: bool) -> Node3D:
	var entry: Dictionary = _index.get(type, {})
	var path := ""

	if is_white:
		path = entry.get("white", "")
		if path == "":
			path = entry.get("neutral", "")
	else:
		path = entry.get("black", "")
		if path == "":
			path = entry.get("neutral", "")

	if path != "":
		var scene := _load_scene(path)
		if scene != null:
			var inst := scene.instantiate() as Node3D
			if inst != null:
				return inst

	# pack com tudo em um arquivo: extrai o nó cujo nome bate com a peça
	for combined_path in _combined:
		var combined_scene := _load_scene(combined_path)
		if combined_scene == null:
			continue
		var extracted := _extract(combined_scene, type)
		if extracted != null:
			return extracted

	return null


func _load_scene(path: String) -> PackedScene:
	if _scenes.has(path):
		return _scenes[path] as PackedScene
	if not ResourceLoader.exists(path):
		push_warning("[piece_model_loader] recurso inexistente: %s" % path)
		_scenes[path] = null
		return null
	var scene := load(path) as PackedScene
	_scenes[path] = scene
	return scene


## Instancia a cena combinada, destaca o nó da peça e descarta o resto.
func _extract(scene: PackedScene, type: StringName) -> Node3D:
	var inst := scene.instantiate()
	if inst == null:
		return null

	var target := _find_by_keyword(inst, KEYWORDS[type])
	if target == null:
		inst.free()
		return null

	inst.remove_child(target)
	inst.free()
	return target as Node3D


func _find_by_keyword(root: Node, keywords: Array) -> Node:
	if root == null:
		return null
	for child in root.get_children():
		var name_lower := child.name.to_lower()
		for kw in keywords:
			if name_lower.contains(kw):
				return child
	for child in root.get_children():
		var found := _find_by_keyword(child, keywords)
		if found != null:
			return found
	return null


# -------------------------------------------------------- normalização -----

## Escala uniforme + centraliza X/Z + assenta a base em Y = 0.
## Tudo calculado a partir de um único AABB, sem re-medir depois de escalar.
func _normalize(model: Node3D, type: StringName) -> void:
	var box := _combined_aabb(model)
	if box.size == Vector3.ZERO:
		return

	var height := maxf(box.size.y, 0.0001)
	var footprint := maxf(maxf(box.size.x, box.size.z), 0.0001)
	var target_h: float = TARGET_HEIGHT.get(type, 0.8)
	var s := minf(target_h / height, MAX_FOOTPRINT / footprint)

	model.scale = Vector3.ONE * s
	model.position = Vector3(
		-box.get_center().x * s,
		-box.position.y * s,
		-box.get_center().z * s
	)


## AABB do modelo no espaço local do nó raiz.
static func _combined_aabb(root: Node3D) -> AABB:
	var box := AABB()
	var found := false
	var root_inv := root.global_transform.affine_inverse()

	for child in root.find_children("*", "VisualInstance3D", true, false):
		var vi := child as VisualInstance3D
		if vi == null:
			continue
		var rel := root_inv * vi.global_transform
		var local_box := rel.xform(vi.get_aabb())
		if not found:
			box = local_box
			found = true
		else:
			box = box.merge(local_box)

	return box


# ---------------------------------------------------------- materiais ------

func _build_materials() -> void:
	for is_white in [true, false]:
		for highlighted in [false, true]:
			_materials[_mat_key(&"flat", is_white, highlighted)] = _make_flat_material(is_white, highlighted)


func _make_flat_material(is_white: bool, highlighted: bool) -> StandardMaterial3D:
	var mat := StandardMaterial3D.new()
	mat.albedo_color = WHITE_COLOR if is_white else BLACK_COLOR
	mat.roughness = 0.55 if is_white else 0.42
	mat.metallic = 0.05
	mat.emission_enabled = highlighted
	if highlighted:
		mat.emission = HIGHLIGHT_COLOR
		mat.emission_energy_multiplier = HIGHLIGHT_ENERGY
	return mat


static func _mat_key(kind: StringName, is_white: bool, highlighted: bool) -> StringName:
	return StringName("%s_%s_%s" % [kind, "w" if is_white else "b", "hi" if highlighted else "lo"])


func _material(kind: StringName, is_white: bool, highlighted: bool) -> Material:
	return _materials[_mat_key(kind, is_white, highlighted)] as Material


func _apply_material(root: Node, material: Material) -> void:
	for child in root.find_children("*", "MeshInstance3D", true, false):
		var mi := child as MeshInstance3D
		if mi.mesh == null:
			continue
		for i in mi.mesh.get_surface_count():
			mi.set_surface_override_material(i, material)


## Packs que já vêm em madeira clara/escura não devem ser achatados.
func _should_override_material(type: StringName, is_white: bool) -> bool:
	if _uses_flat_materials:
		return true
	var entry: Dictionary = _index.get(type, {})
	var color_path: String = entry.get("white" if is_white else "black", "")
	return color_path == ""


# ------------------------------------------------------------ fallback -----

static func _build_fallback(type: StringName, material: Material) -> Node3D:
	var root := Node3D.new()
	root.name = "Fallback_%s" % type

	for part in FALLBACK_SPEC.get(type, []):
		var mi := MeshInstance3D.new()
		mi.material_override = material

		match part["t"]:
			"cyl":
				var cyl := CylinderMesh.new()
				cyl.top_radius = part["rt"]
				cyl.bottom_radius = part["rb"]
				cyl.height = part["h"]
				cyl.radial_segments = CYLINDER_SEGMENTS
				cyl.rings = 1
				mi.mesh = cyl
			"sph":
				var sph := SphereMesh.new()
				sph.radius = part["r"]
				sph.height = part["r"] * 2.0
				sph.radial_segments = SPHERE_SEGMENTS
				sph.rings = SPHERE_RINGS
				mi.mesh = sph
			"box":
				var size: Array = part["s"]
				var box_mesh := BoxMesh.new()
				box_mesh.size = Vector3(size[0], size[1], size[2])
				mi.mesh = box_mesh

		mi.position.y = part["y"]
		if part.has("rx"):
			mi.rotation_degrees.x = part["rx"]
		root.add_child(mi)

	return root
