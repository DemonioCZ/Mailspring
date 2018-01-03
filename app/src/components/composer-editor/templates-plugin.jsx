import React from 'react';
import { RichUtils, EditorState, Modifier, SelectionState } from 'draft-js';

const ENTITY_TYPE = 'TEMPLATEVAR';

// TOOLBAR UI

class ToolbarVariablePicker extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      name: '',
      expanded: false,
    };
  }

  onPrompt = e => {
    e.preventDefault();
    const { editorState } = this.props;

    const selection = editorState.getSelection();
    if (!selection.isCollapsed()) {
      this.setState(
        {
          expanded: true,
          name: getCurrentTemplateVarName(editorState) || '',
        },
        () => {
          setTimeout(() => this._inputEl.focus(), 0);
        }
      );
    }
  };

  onConfirm = e => {
    e.preventDefault();

    // attach the URL value to the LINK that was created when we opened the link modal
    const { name } = this.state;
    const { editorState, onChange } = this.props;

    onChange(editorStateSettingTemplateVarName(editorState, name));

    this.setState({ expanded: false, name: '' }, () => {
      window.requestAnimationFrame(this.props.onFocusComposer);
    });
  };

  onRemove = e => {
    e.preventDefault();
    const { editorState, onChange } = this.props;
    onChange(editorStateSettingTemplateVarName(editorState, null));
  };

  onBlur = e => {
    if (!this._el.contains(e.relatedTarget)) {
      this.setState({ expanded: false });
    }
  };

  render() {
    const { expanded } = this.state;

    return (
      <div
        className="template-var-picker"
        ref={el => (this._el = el)}
        tabIndex={-1}
        onBlur={this.onBlur}
      >
        {getCurrentTemplateVarName(this.props.editorState) ? (
          <button onMouseDown={this.onRemove}>
            <i className="fa fa-unlink" />
          </button>
        ) : (
          <button onMouseDown={this.onPrompt}>
            <i className="fa fa-link" />
          </button>
        )}
        {expanded && (
          <div className="dropdown">
            <input
              type="text"
              placeholder="first_name"
              value={this.state.name}
              ref={el => (this._inputEl = el)}
              onBlur={this.onBlur}
              onChange={e => this.setState({ name: e.target.value })}
              onKeyDown={e => {
                if (e.which === 13) {
                  this.onConfirm(e);
                }
              }}
            />
            <button onMouseDown={this.onConfirm}>Add</button>
          </div>
        )}
      </div>
    );
  }
}

// DRAFTJS CONFIG

/*
Returns editor state with a link entity created / updated to hold the link @data
for the range specified by @selection
*/
export function editorStateSettingTemplateVarName(editorState, name) {
  const contentState = editorState.getCurrentContent();
  const entityKey = getCurrentEntityKey(editorState);

  let nextEditorState = editorState;

  if (!entityKey) {
    const nextContent = contentState.createEntity(ENTITY_TYPE, 'SEGMENTED', { name });
    const entityKey = nextContent.getLastCreatedEntityKey();
    nextEditorState = EditorState.set(editorState, { currentContent: nextContent });
    nextEditorState = RichUtils.toggleLink(nextEditorState, editorState.getSelection(), entityKey);
  } else {
    if (name) {
      nextEditorState = EditorState.set(editorState, {
        currentContent: editorState.getCurrentContent().replaceEntityData(entityKey, { name }),
      });
      // this is a hack that forces the editor to update
      // https://github.com/facebook/draft-js/issues/1047
      nextEditorState = EditorState.forceSelection(nextEditorState, editorState.getSelection());
    } else {
      const nextContent = Modifier.applyEntity(contentState, editorState.getSelection(), null);
      nextEditorState = EditorState.set(editorState, { currentContent: nextContent });
    }
  }

  return nextEditorState;
}

/*
Returns the entityKey for the link entity the user is currently within.
*/
export function getCurrentEntityKey(editorState) {
  const contentState = editorState.getCurrentContent();
  const startKey = editorState.getSelection().getStartKey();
  const startOffset = editorState.getSelection().getStartOffset();
  const block = contentState.getBlockForKey(startKey);
  const linkKey = block.getEntityAt(Math.min(block.text.length - 1, startOffset));

  if (linkKey) {
    const linkInstance = contentState.getEntity(linkKey);
    if (linkInstance.getType() === ENTITY_TYPE) {
      return linkKey;
    }
  }
  return null;
}

/*
Returns the URL for the link entity the user is currently within.
*/
export function getCurrentTemplateVarName(editorState) {
  const entityKey = getCurrentEntityKey(editorState);
  return (
    entityKey &&
    editorState
      .getCurrentContent()
      .getEntity(entityKey)
      .getData().name
  );
}

export const HTMLConfig = {
  htmlToEntity(nodeName, node, createEntity) {
    if (nodeName === 'code') {
      return createEntity(ENTITY_TYPE, 'SEGMENTED', { name: node.textContent });
    }
    if (nodeName === 'span' && node.dataset.tvarname) {
      return createEntity(ENTITY_TYPE, 'SEGMENTED', { name: node.dataset.tvar });
    }
  },
  entityToHTML(entity, originalText) {
    if (entity.type === ENTITY_TYPE) {
      return <span data-tvarname={entity.data.name}>{originalText}</span>;
    }
  },
};

const createTemplatesPlugin = () => {
  const TemplateVar = props => {
    return (
      <code
        onClick={e => {
          const range = document.createRange();
          range.selectNode(e.target);
          document.getSelection().removeAllRanges();
          document.getSelection().addRange(range);
        }}
        className="var empty"
      >
        {props.children}
      </code>
    );
  };

  function findTemplateVarEntities(contentBlock, callback, contentState) {
    contentBlock.findEntityRanges(character => {
      const entityKey = character.getEntity();
      if (!entityKey) return;

      const entity = contentState.getEntity(entityKey);
      return entity.getType() === ENTITY_TYPE;
    }, callback);
  }

  function handleTabToNextVariable(e, { getEditorState, setEditorState }) {
    // collect all the entity ranges
    const editorState = getEditorState();
    const contentState = editorState.getCurrentContent();

    // figure out where we are currently
    const currentKey = editorState.getSelection().getStartKey();
    const currentStart = editorState.getSelection().getStartOffset();
    const currentEnd = editorState.getSelection().getEndOffset();

    let hit = false;
    const forwards = !e.shiftKey;

    for (const block of contentState.getBlocksAsArray()) {
      if (forwards) {
        // forward: advance until we hit the current block
        if (!hit) {
          if (block.key !== currentKey) continue;
          hit = true;
        }
      } else {
        // backward: stop when we pass the current block
        if (!hit) {
          if (block.key === currentKey) hit = true;
        } else {
          break;
        }
      }

      // find an entity range
      let targetRange = null;
      findTemplateVarEntities(
        block,
        (start, end) => {
          if (forwards && targetRange) {
            return;
          }
          if (block.key === currentKey) {
            if (forwards && start < currentEnd) return;
            if (!forwards && end > currentStart) return;
          }
          targetRange = [start, end];
        },
        contentState
      );
      // if we found an entity to select, select it
      if (targetRange) {
        setEditorState(
          EditorState.forceSelection(
            editorState,
            new SelectionState({
              anchorKey: block.key,
              anchorOffset: targetRange[0],
              focusKey: block.key,
              focusOffset: targetRange[1],
              isBackward: false,
              hasFocus: editorState.getSelection().getHasFocus(),
            })
          )
        );
        e.preventDefault();
        return 'handled';
      }
    }
    return 'not-handled';
  }

  return {
    toolbarComponents: [ToolbarVariablePicker],
    onTab: handleTabToNextVariable,
    decorators: [
      {
        strategy: findTemplateVarEntities,
        component: TemplateVar,
      },
    ],
  };
};

export default createTemplatesPlugin;